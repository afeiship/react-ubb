import { BUILT_IN_TAGS, BLANK_TAG, DEFAULT_TAGS, mergeTags, COLOR_PATTERN } from '../src/core/tags';

describe('tags', () => {
  it('exports built-in b/i/color with color valuePattern', () => {
    expect(BUILT_IN_TAGS.map((t) => t.name)).toEqual(['b', 'i', 'color']);
    expect(BUILT_IN_TAGS[2].valuePattern).toBe(COLOR_PATTERN);
  });
  it('DEFAULT_TAGS includes blank plugin', () => {
    expect(DEFAULT_TAGS.map((t) => t.name)).toContain('blank');
    expect(BLANK_TAG.name).toBe('blank');
  });
  it('mergeTags: 同名后者覆盖前者并保持位置', () => {
    const merged = mergeTags(DEFAULT_TAGS, [{ name: 'blank', label: 'x' }, { name: 'mark' }]);
    expect(merged.filter((t) => t.name === 'blank')).toHaveLength(1);
    expect(merged.find((t) => t.name === 'blank')?.label).toBe('x');
    expect(merged.map((t) => t.name)).toEqual(['b', 'i', 'color', 'blank', 'mark']);
  });
  it('COLOR_PATTERN accepts #RGB/#RRGGBB case-insensitive, rejects others', () => {
    expect(COLOR_PATTERN.test('#FFF')).toBe(true);
    expect(COLOR_PATTERN.test('#ff0000')).toBe(true);
    expect(COLOR_PATTERN.test('#FF0000')).toBe(true);
    expect(COLOR_PATTERN.test('red')).toBe(false);
    expect(COLOR_PATTERN.test('#FFFF')).toBe(false);
    expect(COLOR_PATTERN.test('fff')).toBe(false);
  });
});
