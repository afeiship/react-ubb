import { isTextNode, UbbNode } from './ast';
import { parse } from './parser';
import { DEFAULT_TAGS, TagSpec } from './tags';

export interface Sel {
  start: number;
  end: number;
}

export interface TransformResult {
  source: string;
  selection: Sel;
}

type TagNode = Extract<UbbNode, { children: UbbNode[] }>;

// Innermost node of the given tag name whose contentRange (excluding tag
// shells) fully contains the selection — spec §6 wrap/unwrap criterion.
// Iterative pre-order DFS with reverse-pushed children: a deeper containing
// node is popped after any shallower one, so the last match wins. Pruning is
// safe: descendant content ranges nest inside ancestor content ranges.
function findEnclosing(ast: UbbNode[], name: string, sel: Sel): TagNode | undefined {
  let found: TagNode | undefined;
  const stack: UbbNode[] = ast.slice().reverse();
  while (stack.length) {
    const node = stack.pop()!;
    if (isTextNode(node)) continue;
    const [cs, ce] = node.contentRange;
    if (cs <= sel.start && sel.end <= ce) {
      if (node.type === name) found = node;
      for (let k = node.children.length - 1; k >= 0; k--) stack.push(node.children[k]);
    }
  }
  return found;
}

export function wrapTag(
  source: string,
  selection: Sel,
  tagName: string,
  value?: string,
  tags: TagSpec[] = DEFAULT_TAGS,
): TransformResult | null {
  if (!tags.some((t) => t.name === tagName)) return null;
  const { ast } = parse(source, tags);
  const node = findEnclosing(ast, tagName, selection);
  if (node) {
    // unwrap: drop open [range0, contentRange0) and close [contentRange1, range1);
    // the close token sits after the selection, only the open removal shifts it
    const [o0, c1] = node.range;
    const [o1, c0] = node.contentRange;
    const next = source.slice(0, o0) + source.slice(o1, c0) + source.slice(c1);
    const dOpen = o1 - o0;
    return {
      source: next,
      selection: { start: selection.start - dOpen, end: selection.end - dOpen },
    };
  }
  const open = value !== undefined ? `[${tagName}=${value}]` : `[${tagName}]`;
  const close = `[/${tagName}]`;
  const next =
    source.slice(0, selection.start) +
    open +
    source.slice(selection.start, selection.end) +
    close +
    source.slice(selection.end);
  return {
    source: next,
    selection: { start: selection.start + open.length, end: selection.end + open.length },
  };
}

export function insertEmptyTag(
  source: string,
  cursor: number,
  tagName: string,
  value?: string,
  tags: TagSpec[] = DEFAULT_TAGS,
): TransformResult {
  const spec = tags.find((t) => t.name === tagName);
  if (!spec) return { source, selection: { start: cursor, end: cursor } };
  // spec §6: a value-tag without a value inserts [tag=][/tag], cursor after '='
  const bareValue = spec.valuePattern !== undefined && value === undefined;
  const open = value !== undefined ? `[${tagName}=${value}]` : bareValue ? `[${tagName}=]` : `[${tagName}]`;
  const ins = `${open}[/${tagName}]`;
  const at = cursor + open.length - (bareValue ? 1 : 0); // right after '='
  return {
    source: source.slice(0, cursor) + ins + source.slice(cursor),
    selection: { start: at, end: at },
  };
}

export function replaceColor(
  source: string,
  selection: Sel,
  hex: string,
  tags: TagSpec[] = DEFAULT_TAGS,
): TransformResult | null {
  const { ast } = parse(source, tags);
  const node = findEnclosing(ast, 'color', selection);
  if (node) {
    // replace the open token in place, never nest a second color tag
    const o0 = node.range[0];
    const o1 = node.contentRange[0];
    const open = `[color=${hex}]`;
    const next = source.slice(0, o0) + open + source.slice(o1);
    const delta = open.length - (o1 - o0);
    return {
      source: next,
      selection: { start: selection.start + delta, end: selection.end + delta },
    };
  }
  return wrapTag(source, selection, 'color', hex, tags);
}

// Doubling '[' alone is sufficient: ']' only matters inside an escape that a
// '[' started, so a stray ']' parses as a literal and visible length survives.
export function escapeText(text: string): string {
  return text.replace(/\[/g, '[[');
}

// Pending work for the iterative walk: emit a node, or emit a close token.
type Frame = { kind: 'node'; node: UbbNode } | { kind: 'close'; token: string };

export function truncateToVisible(source: string, limit: number, tags: TagSpec[] = DEFAULT_TAGS): string {
  const { ast } = parse(source, tags);
  let count = 0;
  let out = '';
  let cut = false;
  const stack: Frame[] = [];
  for (let k = ast.length - 1; k >= 0; k--) stack.push({ kind: 'node', node: ast[k] });
  while (stack.length) {
    const frame = stack.pop()!;
    if (frame.kind === 'close') {
      out += frame.token; // always emitted once its open token was emitted
      continue;
    }
    if (cut) continue; // after the cut, skip nodes but keep closing open tags
    const node = frame.node;
    if (isTextNode(node)) {
      const budget = limit - count;
      if (node.text.length <= budget) {
        // whole node fits: copy its raw source span verbatim (escapes and
        // stray brackets preserved, no re-escaping corruption)
        out += source.slice(node.range[0], node.range[1]);
        count += node.text.length;
        if (count >= limit) cut = true;
      } else {
        // cut lands mid-node: walk raw in lockstep with rendered text.
        // '[[ ... ]]' escape pairs render as '[ ... ]'; plain raw chars map
        // 1:1 to rendered UTF-16 units (matches parse().visibleLength).
        const raw = source.slice(node.range[0], node.range[1]);
        let ri = 0;
        let used = 0;
        while (ri < raw.length && used < budget) {
          if (raw[ri] === '[' && raw[ri + 1] === '[') {
            const close = raw.indexOf(']]', ri + 2);
            const contentLen = (close === -1 ? raw.length : close) - (ri + 2);
            if (close !== -1 && 2 + contentLen <= budget - used) {
              ri = close + 2; // whole escape fits
              used += 2 + contentLen;
            } else {
              // partial escape: '[[' renders '[' then content maps 1:1; the
              // split tail degrades to literal text via unclosed-escape
              const take = Math.min(budget - used - 1, contentLen);
              ri += 2 + take;
              used += 1 + take;
              break;
            }
          } else {
            ri += 1;
            used += 1;
          }
        }
        out += raw.slice(0, ri);
        count += used;
        cut = true;
      }
    } else {
      out += node.value !== undefined ? `[${node.type}=${node.value}]` : `[${node.type}]`;
      // close first, then children (reverse-pushed) so pops run in document order
      stack.push({ kind: 'close', token: `[/${node.type}]` });
      for (let k = node.children.length - 1; k >= 0; k--) stack.push({ kind: 'node', node: node.children[k] });
    }
  }
  return out;
}
