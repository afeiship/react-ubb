import { Fragment, ReactNode } from 'react';
import { isTextNode, UbbNode } from '../core';
import { CustomTag, TagNode } from './types';

// blank slot width: CJK char ≈ 1em, others ≈ 0.5em; empty slot 4em
function blankWidth(node: UbbNode): string {
  let w = 0;
  const stack: UbbNode[] = isTextNode(node) ? [] : [...node.children].reverse();
  while (stack.length) {
    const nd = stack.pop()!;
    if (isTextNode(nd)) {
      for (const ch of nd.text) w += ch.charCodeAt(0) > 0xff ? 1 : 0.5;
    } else stack.push(...[...nd.children].reverse());
  }
  return `${w || 4}em`;
}

function withLines(text: string): ReactNode[] {
  return text.split(/\r?\n/).flatMap((seg, idx) => (idx === 0 ? [seg] : [<br key={idx} />, seg]));
}

function materializeTag(node: TagNode, key: string, children: ReactNode[], plugins: CustomTag[]): ReactNode {
  // plugin render overrides builtin rendering for ANY tag name (design §4)
  const pluginRender = plugins.find((p) => p.name === node.type)?.render;
  if (pluginRender) return <Fragment key={key}>{pluginRender({ children, node })}</Fragment>;
  switch (node.type) {
    case 'b':
      return <strong key={key}>{children}</strong>;
    case 'i':
      return <em key={key}>{children}</em>;
    case 'color':
      return node.color ? (
        <span key={key} style={{ color: node.color }}>
          {children}
        </span>
      ) : (
        <Fragment key={key}>{children}</Fragment>
      );
    case 'blank':
      return <span key={key} className="react-ubb__blank" style={{ minWidth: blankWidth(node) }} />;
    default:
      return <Fragment key={key}>{children}</Fragment>;
  }
}

interface Frame {
  node: TagNode | null; // null = virtual root wrapper
  key: string; // own element key (unused by the virtual root)
  childPrefix: string; // key prefix for children: root uses `prefix`, tags use `${key}-`
  kids: UbbNode[];
  ci: number; // next child index to push
  elts: ReactNode[]; // resolved child elements
}

// iterative post-order build: deep nesting must not overflow the call stack (untrusted UGC)
export function renderAst(nodes: UbbNode[], plugins: CustomTag[] = [], prefix = ''): ReactNode[] {
  const root: Frame = { node: null, key: '', childPrefix: prefix, kids: nodes, ci: 0, elts: [] };
  const stack: Frame[] = [root];
  while (stack.length) {
    const fr = stack[stack.length - 1];
    if (fr.ci < fr.kids.length) {
      const i = fr.ci++;
      const child = fr.kids[i];
      const key = `${fr.childPrefix}${i}`;
      if (isTextNode(child)) fr.elts.push(<Fragment key={key}>{withLines(child.text)}</Fragment>);
      else stack.push({ node: child, key, childPrefix: `${key}-`, kids: child.children, ci: 0, elts: [] });
      continue;
    }
    // all children resolved → materialize and attach to the parent frame (the new stack top)
    stack.pop();
    if (fr.node) stack[stack.length - 1].elts.push(materializeTag(fr.node, fr.key, fr.elts, plugins));
  }
  return root.elts;
}
