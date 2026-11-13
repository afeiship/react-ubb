import { BUILT_IN_TAGS, BLANK_TAG, DEFAULT_TAGS, mergeTags, COLOR_PATTERN } from '../src/core/tags';
import { parse } from '../src/core/parser';

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
  it('mergeTags does not mutate base or BLANK_TAG', () => {
    mergeTags(DEFAULT_TAGS, [{ name: 'blank', label: 'x' }]);
    expect(BLANK_TAG.label).toBe('Blank');
    expect(DEFAULT_TAGS.find((t) => t.name === 'blank')?.label).toBe('Blank');
  });
  it('mergeTags collapses duplicate names within extra (last wins)', () => {
    const merged = mergeTags([], [{ name: 'a', label: '1' }, { name: 'a', label: '2' }]);
    expect(merged.filter((t) => t.name === 'a')).toHaveLength(1);
    expect(merged.find((t) => t.name === 'a')?.label).toBe('2');
  });
});

const types = (ast: any[]): string[] =>
  ast.flatMap((n) => (n.type === 'text' ? [n.type] : [n.type, ...types(n.children)]));

describe('parser', () => {
  it('plain text stays text', () => {
    const r = parse('hello');
    expect(r.ast).toHaveLength(1);
    expect(r.ast[0]).toMatchObject({ type: 'text', text: 'hello' });
    expect(r.errors).toEqual([]);
    expect(r.visibleLength).toBe(5);
  });

  it('parses b/i nesting with ranges', () => {
    const r = parse('a[b]b[i]c[/i][/b]d');
    expect(types(r.ast)).toEqual(['text', 'b', 'text', 'i', 'text', 'text']);
    const b = r.ast[1] as any;
    expect(b.range).toEqual([1, 17]);
    expect(b.contentRange).toEqual([4, 13]);
    expect(r.visibleLength).toBe(4); // a+b+c+d
  });

  it('uppercase tags are case-insensitive', () => {
    const r = parse('[B]x[/B]');
    expect(r.ast[0].type).toBe('b');
  });

  it('unknown tags stay literal text', () => {
    const r = parse('[foo]x[/foo]');
    expect(r.errors).toEqual([]);
    expect(r.visibleLength).toBe(12);
    expect((r.ast[0] as any).text).toBe('[foo]x[/foo]');
  });

  it('value tag without declared pattern falls back to text', () => {
    const r = parse('[b=x]y[/b]');
    expect(r.ast[0].type).toBe('text');
    // [/b] is stray (no frame opened by degraded [b=x]) → mismatched per spec
    expect(r.errors.map((e) => e.kind)).toEqual(['mismatched']);
  });

  it('valid color value passes and lands on node.color', () => {
    const r = parse('[color=#FF0000]x[/color]');
    expect(r.ast[0]).toMatchObject({ type: 'color', value: '#FF0000', color: '#FF0000' });
    expect(r.errors).toEqual([]);
  });

  it('invalid color keeps node, drops color, records invalid-value', () => {
    const r = parse('[color=red]x[/color]');
    expect(r.ast[0].type).toBe('color');
    expect((r.ast[0] as any).color).toBeUndefined();
    expect(r.errors[0].kind).toBe('invalid-value');
    expect(r.visibleLength).toBe(1);
  });

  it('color without value records invalid-value and degrades', () => {
    const r = parse('[color]x[/color]');
    expect(r.errors[0].kind).toBe('invalid-value');
  });

  it('escape [[b]] renders literal [b] and counts 3 visible chars', () => {
    const r = parse('a[[b]]c');
    expect(r.errors).toEqual([]);
    expect(r.visibleLength).toBe(5);
    expect((r.ast[0] as any).text).toBe('a[b]c');
  });

  it('unclosed escape records error, rest is literal', () => {
    const r = parse('a[[bc');
    expect(r.errors[0].kind).toBe('unclosed-escape');
    expect(r.visibleLength).toBe(4); // a[bc
  });

  it('unclosed tag auto-closes at EOF with error', () => {
    const r = parse('a[b]bc');
    expect(r.ast[1].range).toEqual([1, 6]);
    expect((r.ast[1] as any).contentRange).toEqual([4, 6]);
    expect(r.errors[0].kind).toBe('unclosed');
    expect(r.visibleLength).toBe(3);
  });

  it('interleaved close repairs nearest without swallowing text', () => {
    // [b][i]x[/b][/i] → [/b] closes i implicitly then b; [/i] becomes stray literal
    const r = parse('[b][i]x[/b][/i]');
    expect(types(r.ast)).toEqual(['b', 'i', 'text', 'text']);
    expect(r.visibleLength).toBe(5); // x + [/i]
    expect(r.errors.some((e) => e.kind === 'mismatched')).toBe(true);
  });

  it('stray close with no matching open stays literal + mismatched', () => {
    const r = parse('x[/b]');
    expect(r.errors[0].kind).toBe('mismatched');
    expect(r.visibleLength).toBe(5);
  });

  it('custom value tag via tags param', () => {
    const r = parse('[mark=red]x[/mark]', [
      ...DEFAULT_TAGS,
      { name: 'mark', valuePattern: /^(red|yellow)$/ },
    ]);
    expect(r.ast[0]).toMatchObject({ type: 'mark', value: 'red' });
    expect(r.errors).toEqual([]);
  });

  it('newline stays in text node', () => {
    const r = parse('a\nb');
    expect((r.ast[0] as any).text).toBe('a\nb');
  });

  it('6000-deep [b] nesting parses without recursion overflow', () => {
    const depth = 6000;
    const r = parse('[b]'.repeat(depth) + 'x' + '[/b]'.repeat(depth));
    expect(r.errors).toEqual([]);
    expect(r.visibleLength).toBe(1);
    let node: any = r.ast[0];
    for (let d = 0; d < depth - 1; d++) node = node.children[0];
    expect(node.type).toBe('b');
    expect(node.children[0]).toMatchObject({ type: 'text', text: 'x' });
  });

  it('3000-deep stack survives 5000 stray closes (O(1) nearest-match lookup)', () => {
    const r = parse('[i]'.repeat(3000) + '[/b]'.repeat(5000) + 'x');
    expect(r.errors.filter((e) => e.kind === 'mismatched')).toHaveLength(5000);
    expect(r.errors.filter((e) => e.kind === 'unclosed')).toHaveLength(3000);
    expect(r.visibleLength).toBe(5000 * 4 + 1);
  });

  it('value tag with 100-char value (token longer than any fixed window) parses', () => {
    const value = 'r'.repeat(100);
    const r = parse(`[mark=${value}]x[/mark]`, [
      ...DEFAULT_TAGS,
      { name: 'mark', valuePattern: /^r+$/ },
    ]);
    expect(r.ast[0]).toMatchObject({ type: 'mark', value });
    expect(r.errors).toEqual([]);
    expect(r.visibleLength).toBe(1);
  });

  it('built-in color with >64-char value records invalid-value, not literal degradation', () => {
    const r = parse(`[color=${'x'.repeat(70)}]y[/color]`);
    expect(r.ast[0].type).toBe('color');
    expect((r.ast[0] as any).color).toBeUndefined();
    expect(r.errors[0].kind).toBe('invalid-value');
    expect(r.visibleLength).toBe(1);
  });

  it('brackets with no closing bracket anywhere stay literal', () => {
    const r = parse('a[b[x');
    expect(r.ast[0]).toMatchObject({ type: 'text', text: 'a[b[x' });
    expect(r.errors).toEqual([]);
  });
});
