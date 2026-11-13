import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { isValidElement, ReactNode } from 'react';
import { parse } from '../src/core';
import { renderAst } from '../src/renderer/render-ast';
import { definePlugin } from '../src/renderer/types';
import UbbView from '../src/renderer/ubb-view';

describe('UbbView', () => {
  it('renders b/i/color nesting (AC-01)', () => {
    render(<UbbView source={'[b][i][color=#FF0000]abc[/color][/i][/b]'} />);
    const el = screen.getByText('abc');
    expect(el.tagName).toBe('SPAN');
    expect(el).toHaveStyle({ color: '#FF0000' });
    expect(el.closest('em')).toBeInTheDocument();
    expect(el.closest('strong')).toBeInTheDocument();
  });

  it('invalid color degrades without color style (AC-06)', () => {
    render(<UbbView source={'[color=red]x[/color]'} />);
    const el = screen.getByText('x');
    expect(el.tagName).not.toBe('SPAN');
  });

  it('blank hides text and renders slot with estimated width', () => {
    render(<UbbView source={'答案在[blank]二字[/blank]这里'} />);
    const slot = document.querySelector('.react-ubb__blank') as HTMLElement;
    expect(slot.textContent).toBe('');
    expect(slot.style.minWidth).toBe('2em'); // two CJK chars
  });

  it('empty blank slot gets 4em', () => {
    render(<UbbView source={'[blank][/blank]'} />);
    const slot = document.querySelector('.react-ubb__blank') as HTMLElement;
    expect(slot.style.minWidth).toBe('4em');
  });

  it('escape renders literal tag', () => {
    render(<UbbView source={'[[b]]'} />);
    expect(screen.getByText('[b]')).toBeInTheDocument();
  });

  it('newline renders <br>', () => {
    const { container } = render(<UbbView source={'a\nb'} />);
    expect(container.querySelector('br')).toBeInTheDocument();
  });

  it('CRLF newline renders <br> without stray CR', () => {
    const { container } = render(<UbbView source={'a\r\nb'} />);
    expect(container.querySelector('br')).toBeInTheDocument();
    expect(container.textContent).toBe('ab');
  });

  it('unknown tag stays literal', () => {
    render(<UbbView source={'[foo]x[/foo]'} />);
    expect(screen.getByText('[foo]x[/foo]')).toBeInTheDocument();
  });

  it('plugin render overrides and receives node.value', () => {
    const mark = definePlugin({
      name: 'mark',
      valuePattern: /^(red|yellow)$/,
      render: ({ children, node }) => <mark data-level={node.value}>{children}</mark>,
    });
    render(<UbbView source={'[mark=red]hot[/mark]'} plugins={[mark]} />);
    const el = screen.getByText('hot');
    expect(el.tagName).toBe('MARK');
    expect(el).toHaveAttribute('data-level', 'red');
  });

  it('invalid plugin value degrades and keeps text', () => {
    const mark = definePlugin({
      name: 'mark',
      valuePattern: /^(red)$/,
      render: ({ children, node }) => <mark data-level={node.value ?? 'none'}>{children}</mark>,
    });
    render(<UbbView source={'[mark=blue]hot[/mark]'} plugins={[mark]} />);
    expect(screen.getByText('hot')).toHaveAttribute('data-level', 'none');
  });

  it('plugin named blank overrides builtin rendering', () => {
    const blank2 = definePlugin({ name: 'blank', render: ({ children }) => <u data-testid="bk">{children}</u> });
    render(<UbbView source={'[blank]答案[/blank]'} plugins={[blank2]} />);
    expect(screen.getByTestId('bk').textContent).toBe('答案');
  });

  it('plugin named b overrides builtin strong rendering', () => {
    const b2 = definePlugin({ name: 'b', render: ({ children }) => <b data-testid="pb">{children}</b> });
    const { container } = render(<UbbView source={'[b]x[/b]'} plugins={[b2]} />);
    expect(screen.getByTestId('pb').textContent).toBe('x');
    expect(container.querySelector('strong')).not.toBeInTheDocument();
  });

  it('renderAst handles 5000-deep [b] nesting iteratively', () => {
    const deep = '[b]'.repeat(5000) + 'x' + '[/b]'.repeat(5000);
    const els = renderAst(parse(deep).ast);
    // walk down to the innermost node iteratively
    let el: ReactNode = els[0];
    let depth = 0;
    while (isValidElement<{ children?: ReactNode }>(el)) {
      const kids = el.props.children;
      el = Array.isArray(kids) ? kids[0] : kids;
      depth++;
    }
    expect(el).toBe('x'); // innermost text reached without stack overflow
    expect(depth).toBe(5001); // 5000 nested <strong> + 1 text <Fragment>
  });

  it('2400-deep [b] source renders in UbbView without throwing', () => {
    // jsdom/react-dom recurse internally on DOM mutation, capping feasible DOM depth;
    // 2400 is beyond the old recursive renderAst's limit while inside the jsdom limit
    const deep = '[b]'.repeat(2400) + 'x' + '[/b]'.repeat(2400);
    render(<UbbView source={deep} />);
    expect(screen.getByText('x')).toBeInTheDocument();
  });
});
