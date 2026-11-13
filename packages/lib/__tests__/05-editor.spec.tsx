import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Snapshot, UndoStack, matchShortcut, replaceRange } from '../src/editor/selection';

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
