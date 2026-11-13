import { wrapTag, insertEmptyTag, replaceColor, truncateToVisible, escapeText } from '../src/core/transform';

describe('wrapTag', () => {
  const src = 'a[b]bc[/b]d';
  it('wraps selection outside tag', () => {
    const r = wrapTag(src, { start: 0, end: 1 }, 'b');
    expect(r!.source).toBe('[b]a[/b][b]bc[/b]d');
    expect(r!.selection).toEqual({ start: 3, end: 4 });
  });
  it('unwrap when selection fully inside same tag (AC-02)', () => {
    const r = wrapTag(src, { start: 4, end: 6 }, 'b');
    expect(r!.source).toBe('abcd');
    expect(r!.selection).toEqual({ start: 1, end: 3 });
  });
  it('wrap when selection crosses tag boundary', () => {
    const r = wrapTag(src, { start: 4, end: 11 }, 'b');
    expect(r!.source).toContain('[b]bc[/b]d[/b]');
  });
  it('wrap with value (color)', () => {
    const r = wrapTag('abc', { start: 0, end: 3 }, 'color', '#FF0000');
    expect(r!.source).toBe('[color=#FF0000]abc[/color]');
    expect(r!.selection).toEqual({ start: 15, end: 18 });
  });
  it('unknown tag returns null', () => {
    expect(wrapTag('abc', { start: 0, end: 1 }, 'nope')).toBeNull();
  });
  it('unwraps innermost pair on 6000-deep nesting without throwing', () => {
    const depth = 6000;
    const deep = '[b]'.repeat(depth) + 'x' + '[/b]'.repeat(depth);
    const at = 3 * depth; // offset of 'x'
    const r = wrapTag(deep, { start: at, end: at + 1 }, 'b');
    expect(r!.source).toBe('[b]'.repeat(depth - 1) + 'x' + '[/b]'.repeat(depth - 1));
    expect(r!.selection).toEqual({ start: at - 3, end: at - 2 });
  });
});

describe('insertEmptyTag', () => {
  it('inserts empty pair with cursor inside (FR-11)', () => {
    const r = insertEmptyTag('abc', 1, 'b');
    expect(r.source).toBe('a[b][/b]bc');
    expect(r.selection).toEqual({ start: 4, end: 4 });
  });
  it('value tag inserts [tag=value] with cursor after value', () => {
    const r = insertEmptyTag('abc', 1, 'color', '#FF0000');
    expect(r.source).toBe('a[color=#FF0000][/color]bc');
    expect(r.selection.start).toBe('a[color=#FF0000]'.length);
  });
});

describe('replaceColor', () => {
  it('replaces value in place, no nesting (FR-18 / AC-03)', () => {
    const src = '[b][color=#FF0000]abc[/color][/b]';
    const r = replaceColor(src, { start: 18, end: 20 }, '#00FF00');
    expect(r!.source).toBe('[b][color=#00FF00]abc[/color][/b]');
    expect(r!.selection).toEqual({ start: 18, end: 20 });
  });
  it('wraps when not inside color', () => {
    const r = replaceColor('abc', { start: 0, end: 3 }, '#FF0000');
    expect(r!.source).toBe('[color=#FF0000]abc[/color]');
  });
});

describe('truncateToVisible', () => {
  it('cuts by visible length keeping tags paired (FR-29)', () => {
    expect(truncateToVisible('a[b]bc[/b]def', 4)).toBe('a[b]bc[/b]d');
  });
  it('re-escapes literal brackets from escapes', () => {
    expect(truncateToVisible('[[x]]bc', 4)).toBe('[[x]]b');
  });
  it('6000-deep nesting with limit 1 keeps all closes paired', () => {
    const depth = 6000;
    const src = '[b]'.repeat(depth) + 'abc' + '[/b]'.repeat(depth);
    expect(truncateToVisible(src, 1)).toBe('[b]'.repeat(depth) + 'a' + '[/b]'.repeat(depth));
  });
});

describe('escapeText', () => {
  it('escapes brackets for safe re-insertion', () => {
    expect(escapeText('a[b]c')).toBe('a[[b]]c');
  });
});
