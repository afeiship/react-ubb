import { render, fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createRef } from 'react';
import UbbEditor from '../src';
import { definePlugin } from '../src/renderer/types';
import { Snapshot, UndoStack, matchShortcut, replaceRange } from '../src/editor/selection';
import { mergeLocale } from '../src/editor/locale';
import { zhCN } from '../src/locale/zh-cn';
import { enUS } from '../src/locale/en-us';

describe('replaceRange', () => {
  it('falls back to setRangeText in jsdom and sets selection', () => {
    const { container } = render(<textarea defaultValue="abc" />);
    const ta = container.querySelector('textarea')!;
    const native = replaceRange(ta, 'X', { start: 0, end: 1 }, { start: 1, end: 1 });
    expect(native).toBe(false); // jsdom has no execCommand → fallback
    expect(ta.value).toBe('Xbc');
    expect(ta.selectionStart).toBe(1);
  });
});

describe('UndoStack', () => {
  it('undo/redo with future reset on push', () => {
    const s = new UndoStack();
    const a = { source: 'a', selection: { start: 0, end: 0 } };
    const b = { source: 'ab', selection: { start: 1, end: 1 } };
    const c = { source: 'abc', selection: { start: 2, end: 2 } };
    s.push(a);
    s.push(b);
    expect(s.undo(c)).toEqual(b);
    expect(s.redo(b)).toEqual(c); // redo restores the state current before undo
    expect(s.undo(c)).toEqual(b);
    expect(s.undo(b)).toEqual(a);
    expect(s.undo(a)).toBeUndefined();
  });
  it('push clears the redo future', () => {
    const s = new UndoStack();
    const a = { source: 'a', selection: { start: 0, end: 0 } };
    s.push(a);
    s.undo({ source: 'b', selection: { start: 0, end: 0 } });
    s.push({ source: 'c', selection: { start: 0, end: 0 } });
    expect(s.redo({ source: 'c', selection: { start: 0, end: 0 } })).toBeUndefined();
  });
  it('caps history at 50', () => {
    const s = new UndoStack();
    for (let i = 0; i < 55; i++) s.push({ source: String(i), selection: { start: 0, end: 0 } });
    const cur = { source: 'cur', selection: { start: 0, end: 0 } };
    const sources: string[] = [];
    let snap: Snapshot | undefined;
    while ((snap = s.undo(cur))) sources.push(snap.source);
    expect(sources).toHaveLength(50); // 55 pushes, cap 50 → oldest retained is #5
    expect(sources[49]).toBe('5');
  });
});

describe('matchShortcut', () => {
  const ev = (key: string, opts: { mod?: boolean; shift?: boolean }) =>
    ({ key, metaKey: false, ctrlKey: !!opts.mod, shiftKey: !!opts.shift } as unknown as KeyboardEvent);
  it('matches mod+b', () => {
    expect(matchShortcut(ev('b', { mod: true }), 'mod+b')).toBe(true);
    expect(matchShortcut(ev('b', {}), 'mod+b')).toBe(false);
  });
  it('metaKey counts as mod (macOS Cmd)', () => {
    expect(
      matchShortcut({ key: 'b', metaKey: true, ctrlKey: false, shiftKey: false } as KeyboardEvent, 'mod+b'),
    ).toBe(true);
  });
  it('mod+b with shift held does not match (exact modifiers)', () => {
    expect(matchShortcut(ev('b', { mod: true, shift: true }), 'mod+b')).toBe(false);
  });
  it('matches mod+shift+z', () => {
    expect(matchShortcut(ev('z', { mod: true, shift: true }), 'mod+shift+z')).toBe(true);
    expect(matchShortcut(ev('z', { mod: true }), 'mod+shift+z')).toBe(false);
  });
});

describe('locale', () => {
  it('zh/en both provide full label set', () => {
    expect(zhCN.bold).toBe('加粗');
    expect(enUS.bold).toBe('Bold');
    expect(zhCN.counter(3, 10)).toBe('3 / 10');
    expect(enUS.counter(3)).toBe('3');
  });
  it('mergeLocale patches partially', () => {
    const merged = mergeLocale(zhCN, { bold: 'B' });
    expect(merged.bold).toBe('B');
    expect(merged.italic).toBe('斜体');
  });
});

const ta = () => document.querySelector('.react-ubb__textarea') as HTMLTextAreaElement;
const select = (start: number, end: number) => {
  const el = ta();
  el.setSelectionRange(start, end);
  fireEvent.select(el);
};

describe('editor interactions', () => {
  it('AC-01: select + bold button wraps and preview shows bold', () => {
    render(<UbbEditor defaultValue="abc" />);
    select(0, 3);
    fireEvent.click(screen.getByRole('button', { name: '加粗' }));
    expect(ta().value).toBe('[b]abc[/b]');
    expect(document.querySelector('.react-ubb__preview strong')).toBeInTheDocument();
  });

  it('AC-02: clicking bold again unwraps', () => {
    render(<UbbEditor defaultValue={'[b]abc[/b]'} />);
    select(3, 6);
    fireEvent.click(screen.getByRole('button', { name: '加粗' }));
    expect(ta().value).toBe('abc');
  });

  it('AC-03: bold inside selection + color via ref.insertTag nests once', () => {
    const ref = createRef<any>();
    render(<UbbEditor ref={ref} defaultValue={'[b]abc[/b]'} />);
    select(3, 6);
    ref.current.insertTag('color', '#FF0000');
    expect(ta().value).toBe('[b][color=#FF0000]abc[/color][/b]');
  });

  it('AC-13 前半: blank button wraps selection', () => {
    render(<UbbEditor defaultValue="答案" />);
    select(0, 2);
    fireEvent.click(screen.getByRole('button', { name: '插空' }));
    expect(ta().value).toBe('[blank]答案[/blank]');
  });

  it('FR-13: shortcut mod+b wraps focused editor', () => {
    render(<UbbEditor defaultValue="abc" />);
    select(0, 3);
    fireEvent.keyDown(ta(), { key: 'b', ctrlKey: true });
    expect(ta().value).toBe('[b]abc[/b]');
  });

  it('FR-38: plugin shortcut intercepted when focused', () => {
    const mark = definePlugin({ name: 'mark', label: 'M', shortcut: 'mod+m', render: ({ children }) => <u>{children}</u> });
    render(<UbbEditor defaultValue="abc" plugins={[mark]} />);
    select(0, 3);
    fireEvent.keyDown(ta(), { key: 'm', ctrlKey: true });
    expect(ta().value).toBe('[mark]abc[/mark]');
  });

  it('AC-11: readOnly shortcuts do nothing', () => {
    render(<UbbEditor defaultValue="abc" readOnly />);
    select(0, 3);
    fireEvent.keyDown(ta(), { key: 'b', ctrlKey: true });
    expect(ta().value).toBe('abc');
  });

  it('AC-04: paste takes text/plain only', () => {
    render(<UbbEditor defaultValue="ab" />);
    select(2, 2);
    fireEvent.paste(ta(), { clipboardData: { getData: (t: string) => (t === 'text/plain' ? '<b>x</b>' : 'SHOULD NOT APPEAR') } });
    expect(ta().value).toBe('ab<b>x</b>');
  });

  it('FR-25: stripPaste removes tags from pasted text', () => {
    render(<UbbEditor defaultValue="" stripPaste />);
    fireEvent.paste(ta(), { clipboardData: { getData: () => '[b]x[/b]' } });
    expect(ta().value).toBe('x');
  });

  it('FR-29: maxLength truncates by visible length keeping tags paired', () => {
    render(<UbbEditor defaultValue="abcdef" maxLength={4} />);
    fireEvent.input(ta(), { target: { value: 'a[b]bc[/b]def' } });
    expect(ta().value).toBe('a[b]bc[/b]d');
  });

  it('AC-10: fallback undo restores previous source and selection', () => {
    render(<UbbEditor defaultValue="abc" />);
    select(0, 3);
    fireEvent.click(screen.getByRole('button', { name: '加粗' }));
    expect(ta().value).toBe('[b]abc[/b]');
    fireEvent.keyDown(ta(), { key: 'z', ctrlKey: true });
    expect(ta().value).toBe('abc');
    expect(ta().selectionStart).toBe(0);
    expect(ta().selectionEnd).toBe(3);
    fireEvent.keyDown(ta(), { key: 'z', ctrlKey: true, shiftKey: true });
    expect(ta().value).toBe('[b]abc[/b]');
  });

  it('AC-05: unclosed input shows warning alert', () => {
    const { container } = render(<UbbEditor defaultValue="" />);
    fireEvent.input(ta(), { target: { value: '[b]x' } });
    expect(container.querySelector('.react-ubb__warn')).toBeInTheDocument();
  });
});
