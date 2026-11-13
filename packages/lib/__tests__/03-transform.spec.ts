import { wrapTag, insertEmptyTag, replaceColor, truncateToVisible, escapeText } from '../src/core/transform';
import { parse } from '../src/core/parser';
import { toPlainText } from '../src/core/plain';

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
  it('value tag without value inserts [tag=][/tag] with cursor after =', () => {
    const r = insertEmptyTag('abc', 1, 'color');
    expect(r.source).toBe('a[color=][/color]bc');
    expect(r.selection).toEqual({ start: 'a[color='.length, end: 'a[color='.length });
  });
  it('unknown tag returns input unchanged', () => {
    const r = insertEmptyTag('abc', 2, 'nope');
    expect(r.source).toBe('abc');
    expect(r.selection).toEqual({ start: 2, end: 2 });
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
  it('shifts selection by open-length delta when value length differs', () => {
    const r = replaceColor('[color=#FF0000]x[/color]', { start: 15, end: 16 }, '#0F0');
    expect(r!.source).toBe('[color=#0F0]x[/color]');
    expect(r!.selection).toEqual({ start: 12, end: 13 });
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
  it('never exceeds the visible limit and never leaves tags unclosed', () => {
    const corpus = ['a[b]c]d[/b]ef', '😀x😀y', '[[x]]ab', '[b][color=#FF0000]ab[/color][/b]cd'];
    for (const src of corpus) {
      const full = parse(src).visibleLength;
      for (let limit = 0; limit <= full + 2; limit++) {
        const res = parse(truncateToVisible(src, limit));
        expect(res.visibleLength).toBeLessThanOrEqual(limit);
        expect(res.errors.some((e) => e.kind === 'unclosed')).toBe(false);
      }
    }
  });
});

describe('escapeText', () => {
  it('doubles [ only, keeping stray ] single', () => {
    expect(escapeText('a[b]c')).toBe('a[[b]c');
    expect(escapeText('a]b')).toBe('a]b');
  });
  it('preserves visible length after parse round-trip', () => {
    for (const s of ['a]b', 'a[b]c', '[x]', ']', 'plain', 'a]b[c]', 'x[y']) {
      expect(toPlainText(escapeText(s)).length).toBe(s.length);
    }
  });
});
