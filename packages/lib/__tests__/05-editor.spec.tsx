import { render, fireEvent, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createRef } from 'react';
import UbbEditor from '../src';
import ColorPicker, { DEFAULT_COLORS } from '../src/editor/color-picker';
import { definePlugin } from '../src/renderer/types';
import { Snapshot, UndoStack, matchShortcut, replaceRange } from '../src/editor/selection';
import { mergeLocale } from '../src/editor/locale';
import { zhCN } from '../src/locale/zh-cn';
import { enUS } from '../src/locale/en-us';

// jsdom 29 ships no localStorage — memory-backed stand-in so the components'
// persistence paths (real localStorage in browsers, guarded by try/catch
// where unavailable) are exercised through the same interface. File-scoped:
// covers both the color picker recents and the editor autoSave draft.
beforeAll(() => {
  if (!(globalThis as { localStorage?: Storage }).localStorage) {
    const mem = new Map<string, string>();
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
      clear: () => void mem.clear(),
    } as Storage;
  }
});

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
  it('typing pushes within the merge window collapse to one undo step', () => {
    const s = new UndoStack();
    s.push({ source: 'a', selection: { start: 0, end: 0 } }); // transform
    s.push({ source: 'ab', selection: { start: 0, end: 0 } }, { mergeWithinMs: 800 }); // typing 1
    s.push({ source: 'abc', selection: { start: 0, end: 0 } }, { mergeWithinMs: 800 }); // typing 2 — collapsed
    const snap = s.undo({ source: 'abcd', selection: { start: 0, end: 0 } });
    expect(snap!.source).toBe('ab'); // one step back = pre-typing state
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
    vi.useFakeTimers();
    render(<UbbEditor defaultValue="abc" />);
    select(0, 3);
    fireEvent.click(screen.getByRole('button', { name: '加粗' }));
    expect(ta().value).toBe('[b]abc[/b]');
    // FR-24: the preview renders from the debounced source — settle the
    // debounce before asserting (the wrap itself is still immediate)
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(document.querySelector('.react-ubb__preview strong')).toBeInTheDocument();
    vi.useRealTimers();
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

  it('FR-26: maxLength clamp deferred during IME composition, applied on compositionEnd', () => {
    render(<UbbEditor defaultValue="ab" maxLength={4} />);
    fireEvent.compositionStart(ta());
    fireEvent.input(ta(), { target: { value: 'abcdef' } });
    expect(ta().value).toBe('abcdef'); // NOT truncated mid-composition
    fireEvent.compositionEnd(ta());
    expect(ta().value).toBe('abcd');
  });

  it('undo collapses typing burst: wrap → type → mod+z returns to post-wrap state', () => {
    render(<UbbEditor defaultValue="abc" />);
    select(0, 3);
    fireEvent.click(screen.getByRole('button', { name: '加粗' }));
    expect(ta().value).toBe('[b]abc[/b]');
    fireEvent.input(ta(), { target: { value: '[b]abc[/b]XY' } });
    fireEvent.keyDown(ta(), { key: 'z', ctrlKey: true });
    expect(ta().value).toBe('[b]abc[/b]');
  });

  it('redo after typing following undo is a no-op (no silent data loss)', () => {
    render(<UbbEditor defaultValue="abc" />);
    select(0, 3);
    fireEvent.click(screen.getByRole('button', { name: '加粗' }));
    fireEvent.keyDown(ta(), { key: 'z', ctrlKey: true });
    expect(ta().value).toBe('abc');
    fireEvent.input(ta(), { target: { value: 'abcXY' } });
    fireEvent.keyDown(ta(), { key: 'z', ctrlKey: true, shiftKey: true });
    expect(ta().value).toBe('abcXY');
  });
});

describe('color picker', () => {
  // Array.from (not spread): NodeListOf is not iterable under lib without
  // dom.iterable / es5 target — keeps `tsc --noEmit` clean on project files
  const swatches = () => Array.from(document.querySelectorAll<HTMLElement>('.react-ubb__swatch'));

  it('AC-03: select in bold + pick first swatch → nested once', () => {
    render(<UbbEditor defaultValue={'[b]abc[/b]'} />);
    select(3, 6);
    fireEvent.click(screen.getByRole('button', { name: '颜色' }));
    expect(document.querySelector('.react-ubb__color-panel')).toBeInTheDocument();
    fireEvent.click(swatches()[0]); // DEFAULT_COLORS[0] = '#000000'
    expect(ta().value).toBe('[b][color=#000000]abc[/color][/b]');
  });

  it('FR-18: pick again inside color replaces value, no nesting', () => {
    render(<UbbEditor defaultValue={'[color=#FF0000]abc[/color]'} />);
    select(15, 18); // content 'abc' at [15,18)
    fireEvent.click(screen.getByRole('button', { name: '颜色' }));
    fireEvent.click(swatches()[0]); // #000000
    expect(ta().value).toBe('[color=#000000]abc[/color]');
  });

  it('invalid hex is ignored: no wrap, panel stays open', () => {
    render(<UbbEditor defaultValue="abc" />);
    select(0, 3);
    fireEvent.click(screen.getByRole('button', { name: '颜色' }));
    const input = document.querySelector('.react-ubb__hex-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'zz' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(ta().value).toBe('abc');
    expect(document.querySelector('.react-ubb__color-panel')).toBeInTheDocument();
  });

  it('FR-19: Esc closes panel; overlay click closes', () => {
    render(<UbbEditor defaultValue="abc" />);
    fireEvent.click(screen.getByRole('button', { name: '颜色' }));
    expect(document.querySelector('.react-ubb__color-panel')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('.react-ubb__color-panel')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '颜色' }));
    fireEvent.click(document.querySelector('.react-ubb__overlay')!);
    expect(document.querySelector('.react-ubb__color-panel')).toBeNull();
  });

  it('hex input commits on Enter with valid value; invalid ignored', () => {
    render(<UbbEditor defaultValue="abc" />);
    select(0, 3);
    fireEvent.click(screen.getByRole('button', { name: '颜色' }));
    const input = document.querySelector('.react-ubb__hex-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '#00FF00' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(ta().value).toBe('[color=#00FF00]abc[/color]');
    // panel closed after commit
    expect(document.querySelector('.react-ubb__color-panel')).toBeNull();
  });

  it('no selection: picking color inserts empty pair with cursor inside', () => {
    const ref = createRef<any>();
    render(<UbbEditor ref={ref} defaultValue="abc" />);
    ref.current.focus();
    select(3, 3); // collapsed at end
    fireEvent.click(screen.getByRole('button', { name: '颜色' }));
    fireEvent.click(swatches()[0]);
    // collapsed selection → wrapTag degenerates to empty pair insertion with selection shifted
    expect(ta().value).toBe('abc[color=#000000][/color]');
  });

  it('recent colors capped at 8, most-recent-first, persisted', () => {
    localStorage.clear();
    render(<ColorPicker colors={DEFAULT_COLORS} onSelect={() => {}} onClose={() => {}} />);
    const input = () => document.querySelector('.react-ubb__hex-input') as HTMLInputElement;
    for (const c of ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888', '#999999']) {
      fireEvent.change(input(), { target: { value: c } });
      fireEvent.keyDown(input(), { key: 'Enter' });
    }
    const recent = JSON.parse(localStorage.getItem('react-ubb-recent-colors')!);
    expect(recent).toHaveLength(8);
    expect(recent[0]).toBe('#999999');
  });

  it('readOnly: color button disabled (toolbar already handles), panel not openable', () => {
    render(<UbbEditor defaultValue="abc" readOnly />);
    expect((screen.getByRole('button', { name: '颜色' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('preview & autosave', () => {
  it('preview debounced 200ms (FR-24)', () => {
    vi.useFakeTimers();
    render(<UbbEditor defaultValue="" />);
    fireEvent.input(ta(), { target: { value: '[b]x[/b]' } });
    expect(document.querySelector('.react-ubb__preview strong')).toBeNull();
    // act: React 18 flushes the timer's setState in a microtask — advance
    // synchronously inside act so the DOM is settled before asserting
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(document.querySelector('.react-ubb__preview strong')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('over 20k chars freezes preview and shows refresh button (FR-24)', () => {
    const long = 'x'.repeat(20001);
    render(<UbbEditor defaultValue={long} />);
    expect(screen.getByRole('button', { name: '刷新预览' })).toBeInTheDocument();
    expect(document.querySelector('.react-ubb__preview')?.textContent?.length).toBe(0);
  });

  it('autoSave persists draft to localStorage (FR-35)', () => {
    localStorage.clear();
    render(<UbbEditor defaultValue="" autoSave={{ key: 'my-draft' }} />);
    fireEvent.input(ta(), { target: { value: 'hello' } });
    expect(localStorage.getItem('my-draft')).toBe('hello');
  });

  it('autoSave restores draft on mount when uncontrolled without defaultValue', () => {
    localStorage.setItem('my-draft', 'restored');
    render(<UbbEditor autoSave={{ key: 'my-draft' }} />);
    expect(ta().value).toBe('restored');
  });

  it('color panel autofocuses hex input and returns focus to textarea on Esc', () => {
    render(<UbbEditor defaultValue="abc" />);
    fireEvent.click(screen.getByRole('button', { name: '颜色' }));
    expect(document.querySelector('.react-ubb__hex-input')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(ta()).toHaveFocus();
  });
});
