import { Fragment, ReactNode } from 'react';
import { isTextNode, UbbNode } from '../core';
import { CustomTag } from './types';

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
  return text.split('\n').flatMap((seg, idx) => (idx === 0 ? [seg] : [<br key={idx} />, seg]));
}

export function renderAst(nodes: UbbNode[], plugins: CustomTag[] = [], prefix = ''): ReactNode[] {
  return nodes.map((node, idx) => {
    const key = `${prefix}${idx}`;
    if (isTextNode(node)) return <Fragment key={key}>{withLines(node.text)}</Fragment>;
    const children = renderAst(node.children, plugins, `${key}-`);
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
      case 'blank': {
        const plugin = plugins.find((p) => p.name === 'blank');
        if (plugin?.render) return <Fragment key={key}>{plugin.render({ children, node })}</Fragment>;
        return <span key={key} className="react-ubb__blank" style={{ minWidth: blankWidth(node) }} />;
      }
      default: {
        const plugin = plugins.find((p) => p.name === node.type);
        return plugin?.render ? (
          <Fragment key={key}>{plugin.render({ children, node })}</Fragment>
        ) : (
          <Fragment key={key}>{children}</Fragment>
        );
      }
    }
  });
}
