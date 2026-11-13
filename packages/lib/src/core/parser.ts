import { ParseError, ParseResult, UbbNode } from './ast';
import { DEFAULT_TAGS, TagSpec } from './tags';

const OPEN_RE = /^\[([a-z]+)(?:=([^\]]*))?\]/i;
const CLOSE_RE = /^\[\/([a-z]+)\]/i;

interface Frame {
  spec: TagSpec;
  node: Extract<UbbNode, { children: UbbNode[] }>;
}

export function parse(source: string, tags: TagSpec[] = DEFAULT_TAGS): ParseResult {
  const specs = new Map<string, TagSpec>();
  for (const t of tags) specs.set(t.name.toLowerCase(), t);

  const errors: ParseError[] = [];
  const roots: UbbNode[] = [];
  const stack: Frame[] = [];
  let buf = '';
  let bufStart = 0;

  const attach = (node: UbbNode) => {
    const top = stack[stack.length - 1];
    if (top) top.node.children.push(node);
    else roots.push(node);
  };
  const appendBuf = (s: string, start: number) => {
    if (!buf) bufStart = start;
    buf += s;
  };
  const flushText = (end: number) => {
    if (buf) attach({ type: 'text', text: buf, range: [bufStart, end] });
    buf = '';
  };

  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];

    // 1. escape: [[ ... ]]
    if (ch === '[' && source[i + 1] === '[') {
      const close = source.indexOf(']]', i + 2);
      if (close === -1) {
        errors.push({ kind: 'unclosed-escape', pos: i, message: `Unclosed escape at ${i}` });
        appendBuf('[' + source.slice(i + 2), i);
        i = n;
      } else {
        appendBuf('[' + source.slice(i + 2, close) + ']', i);
        i = close + 2;
      }
      continue;
    }

    // 2/3. tag tokens
    if (ch === '[') {
      const rest = source.slice(i, i + 64); // token length cap
      if (source[i + 1] === '/') {
        const m = CLOSE_RE.exec(rest);
        if (m && specs.has(m[1].toLowerCase())) {
          const name = m[1].toLowerCase();
          const tokenEnd = i + m[0].length;
          let idx = -1;
          for (let k = stack.length - 1; k >= 0; k--) {
            if (stack[k].spec.name === name) { idx = k; break; }
          }
          if (idx === -1) {
            errors.push({ kind: 'mismatched', pos: i, message: `Unexpected [/${name}]` });
            appendBuf(m[0], i);
            i = tokenEnd;
            continue;
          }
          flushText(i);
          for (let k = stack.length - 1; k > idx; k--) {
            const f = stack.pop()!;
            f.node.range[1] = i;
            f.node.contentRange[1] = i;
            errors.push({ kind: 'mismatched', pos: i, message: `Nested [${f.spec.name}] closed implicitly at ${i}` });
          }
          const f = stack.pop()!;
          f.node.range[1] = tokenEnd;
          f.node.contentRange[1] = i;
          i = tokenEnd;
          continue;
        }
      } else {
        const m = OPEN_RE.exec(rest);
        if (m && specs.has(m[1].toLowerCase())) {
          const spec = specs.get(m[1].toLowerCase())!;
          const tokenEnd = i + m[0].length;
          const rawValue = m[2];
          let value: string | undefined;
          if (rawValue !== undefined) {
            if (!spec.valuePattern) {
              appendBuf(m[0], i); // value not allowed → plain text
              i = tokenEnd;
              continue;
            }
            if (!spec.valuePattern.test(rawValue)) {
              errors.push({ kind: 'invalid-value', pos: i, message: `Invalid value "${rawValue}" for [${spec.name}]` });
            } else {
              value = rawValue;
            }
          } else if (spec.valuePattern) {
            errors.push({ kind: 'invalid-value', pos: i, message: `Missing value for [${spec.name}]` });
          }
          flushText(i);
          const node: Extract<UbbNode, { children: UbbNode[] }> = {
            type: spec.name,
            children: [],
            range: [i, tokenEnd],
            contentRange: [tokenEnd, tokenEnd],
          };
          if (value !== undefined) {
            node.value = value;
            if (spec.name === 'color') node.color = value;
          }
          attach(node);
          stack.push({ spec, node });
          i = tokenEnd;
          continue;
        }
      }
    }

    // 4. ordinary char
    appendBuf(ch, i);
    i++;
  }

  flushText(n);
  for (let k = stack.length - 1; k >= 0; k--) {
    const f = stack[k];
    f.node.range[1] = n;
    f.node.contentRange[1] = n;
    errors.push({ kind: 'unclosed', pos: f.node.range[0], message: `Unclosed [${f.spec.name}]` });
  }

  let visible = 0;
  const walk = (nodes: UbbNode[]) => {
    for (const nd of nodes) {
      if (nd.type === 'text') visible += nd.text.length;
      else walk(nd.children);
    }
  };
  walk(roots);

  return { ast: roots, errors, visibleLength: visible, sourceLength: source.length };
}
