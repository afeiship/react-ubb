import { isTextNode, UbbNode } from './ast';
import { parse } from './parser';
import { DEFAULT_TAGS, TagSpec } from './tags';

// Iterative pre-order walk (reverse-pushed explicit stack): preserves document
// order and cannot overflow the call stack on deeply nested trees.
function collect(nodes: UbbNode[], out: string[]): void {
  const stack: UbbNode[] = nodes.slice().reverse();
  while (stack.length) {
    const node = stack.pop()!;
    if (isTextNode(node)) {
      out.push(node.text);
    } else {
      const cs = node.children;
      for (let k = cs.length - 1; k >= 0; k--) stack.push(cs[k]);
    }
  }
}

export function toPlainText(source: string, tags: TagSpec[] = DEFAULT_TAGS): string {
  const out: string[] = [];
  collect(parse(source, tags).ast, out);
  return out.join('');
}

export function visibleLength(source: string, tags: TagSpec[] = DEFAULT_TAGS): number {
  return toPlainText(source, tags).length;
}
