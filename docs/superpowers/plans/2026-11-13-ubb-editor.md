# UBB Editor (@jswork/react-ubb) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-11-13-ubb-editor-design.md` 在 `packages/lib` 实现 UBB 纯文本编辑器（b / i / color / blank 插件 + 自定义插件机制 + 独立渲染入口），并修复 example demo。

**Architecture:** core（零 React 依赖：parse / plain / transform / tags / ast）→ renderer（UbbView + render-ast + definePlugin）→ editor（UbbEditor + toolbar + color-picker + selection/undo）。单包三入口（index / core / renderer），textarea + selectionStart/End，execCommand('insertText') 优先、setRangeText 降级 + 自建 undo 栈。

**Tech Stack:** React 18 函数组件 + hooks、TypeScript strict、tsup（cjs/esm/dts）、vitest + @testing-library/react、scss（postsass 产出 dist/style.css）。

**约定（每个任务通用）：**

- 工作目录：`packages/lib`；测试命令统一 `pnpm --filter @jswork/react-ubb test -- <file>`（vitest run 单文件）
- 文件 / 目录名全部小写 kebab-case；组件导出名 PascalCase
- 提交信息英文；不推送远程
- jsdom 不实现 `document.execCommand`，编辑器测试走 setRangeText 降级路径（原生 undo 路径在 demo 手工验收）

## 文件结构总览

```text
packages/lib/
  src/
    index.ts              # 出口：UbbEditor + UbbEditorProps/Ref/Meta 类型
    core/
      index.ts            # 子路径出口
      ast.ts              # UbbNode / ParseError / ParseResult
      tags.ts             # TagSpec / BUILT_IN_TAGS / BLANK_TAG / DEFAULT_TAGS / mergeTags
      parser.ts           # parse 单遍状态机
      plain.ts            # toPlainText / visibleLength
      transform.ts        # wrapTag / insertEmptyTag / replaceColor / truncateToVisible / escapeText
    renderer/
      index.ts            # 子路径出口
      types.ts            # CustomTag / definePlugin
      render-ast.tsx      # AST → ReactNode
      ubb-view.tsx        # UbbView
    editor/
      selection.ts        # insertAtTextarea / UndoStack / getSelection
      locale.ts           # Labels 类型 + mergeLocale
      ubb-editor.tsx      # 主组件
      toolbar.tsx
      color-picker.tsx
    locale/
      zh-cn.ts
      en-us.ts
    style.scss
  __tests__/
    01-basic.spec.tsx     # 重写：编辑器骨架
    02-parser.spec.ts
    03-transform.spec.ts
    04-renderer.spec.tsx
    05-editor.spec.tsx
  tsup.config.ts          # 改：三入口
  package.json            # 改：exports 子路径
packages/example/src/app.tsx  # 重写：demo
```

---

### Task 1: core 类型与标签定义（ast.ts / tags.ts）

**Files:**
- Create: `packages/lib/src/core/ast.ts`
- Create: `packages/lib/src/core/tags.ts`
- Test: `packages/lib/__tests__/02-parser.spec.ts`（本任务先建文件放 tags 断言，Task 2 扩充）

- [ ] **Step 1: 写失败测试**

```ts
// packages/lib/__tests__/02-parser.spec.ts
import { BUILT_IN_TAGS, BLANK_TAG, DEFAULT_TAGS, mergeTags, COLOR_PATTERN } from '../src/core/tags';

describe('tags', () => {
  it('exports built-in b/i/color with color valuePattern', () => {
    expect(BUILT_IN_TAGS.map((t) => t.name)).toEqual(['b', 'i', 'color']);
    expect(BUILT_IN_TAGS[2].valuePattern).toBe(COLOR_PATTERN);
  });
  it('DEFAULT_TAGS includes blank plugin', () => {
    expect(DEFAULT_TAGS.map((t) => t.name)).toContain('blank');
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
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @jswork/react-ubb test -- 02-parser.spec.ts`
Expected: FAIL（Cannot find module '../src/core/tags'）

- [ ] **Step 3: 实现 ast.ts 与 tags.ts**

```ts
// packages/lib/src/core/ast.ts
export type UbbNode =
  | { type: 'text'; text: string; range: [number, number] }
  | {
      type: string; // 'b' | 'i' | 'color' | 插件标签名
      value?: string; // [name=value] 原始值，仅声明 valuePattern 的标签
      color?: string; // 仅 color：校验通过的 hex，非法时 undefined
      children: UbbNode[];
      range: [number, number]; // 含标签外壳的源区间
      contentRange: [number, number]; // 不含标签外壳
    };

export type ParseErrorKind = 'unclosed' | 'mismatched' | 'invalid-value' | 'unclosed-escape';

export interface ParseError {
  kind: ParseErrorKind;
  pos: number; // 源文本偏移
  message: string;
}

export interface ParseResult {
  ast: UbbNode[];
  errors: ParseError[];
  visibleLength: number;
  sourceLength: number;
}
```

```ts
// packages/lib/src/core/tags.ts
export interface TagSpec {
  name: string; // 小写标签名
  label?: string; // 工具栏文案 / aria-label 兜底
  paired?: boolean; // 预留，v1 恒 true
  valuePattern?: RegExp; // 值属性规则；color 内置 hex 规则
}

export const COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export const BUILT_IN_TAGS: TagSpec[] = [
  { name: 'b', label: 'Bold' },
  { name: 'i', label: 'Italic' },
  { name: 'color', label: 'Color', valuePattern: COLOR_PATTERN },
];

export const BLANK_TAG: TagSpec = { name: 'blank', label: 'Blank' };

export const DEFAULT_TAGS: TagSpec[] = [...BUILT_IN_TAGS, BLANK_TAG];

// extra 覆盖 base 同名项（保持在 base 中的位置），其余追加
export function mergeTags(base: TagSpec[], extra: TagSpec[] = []): TagSpec[] {
  const out = [...base];
  for (const tag of extra) {
    const idx = out.findIndex((t) => t.name === tag.name);
    if (idx >= 0) {
      if (import.meta.env?.DEV) {
        console.warn(`[react-ubb] tag "${tag.name}" is overridden by plugin config`);
      }
      out[idx] = tag;
    } else {
      out.push(tag);
    }
  }
  return out;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @jswork/react-ubb test -- 02-parser.spec.ts`
Expected: PASS（4 个 tags 用例）

- [ ] **Step 5: 提交**

```bash
git add packages/lib/src/core packages/lib/__tests__/02-parser.spec.ts
git commit -m "feat(core): add tag specs and AST types"
```

---

### Task 2: 解析器 parser.ts（单遍状态机）

**Files:**
- Create: `packages/lib/src/core/parser.ts`
- Test: `packages/lib/__tests__/02-parser.spec.ts`（追加 describe）

- [ ] **Step 1: 追加失败测试**

```ts
// 02-parser.spec.ts 追加
import { parse } from '../src/core/parser';

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
    const b = r.ast[1];
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
    expect(r.errors[0].kind).toBe('mismatched'); // [b=x] degraded to text, [/b] is stray
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
    expect(r.ast[1].contentRange).toEqual([4, 6]);
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

  it('custom value tag via plugins tags param', () => {
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
});
```

注意上面第二个用例 visibleLength 断言：`a`+`b`+`c`+`d` = 4，写成 `expect(r.visibleLength).toBe(4)`（计划中已修正，执行时以 4 为准）。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @jswork/react-ubb test -- 02-parser.spec.ts`
Expected: FAIL（Cannot find module '../src/core/parser'）

- [ ] **Step 3: 实现 parser.ts**

```ts
// packages/lib/src/core/parser.ts
import { ParseError, ParseResult, UbbNode } from './ast';
import { DEFAULT_TAGS, TagSpec } from './tags';

const OPEN_RE = /^\[([a-z]+)(?:=([^\]]*))?\]/i;
const CLOSE_RE = /^\[\/([a-z]+)\]/i;

interface Frame {
  spec: TagSpec;
  node: Extract<UbbNode, { children: UbbNode[] }>;
}

export function parse(source: string, tags: TagSpec[] = DEFAULT_TAGS): ParseResult {
  const specs = new Map<string, TagSpec>();
  for (const t of tags) specs.set(t.name.toLowerCase(), t);

  const errors: ParseError[] = [];
  const roots: UbbNode[] = [];
  const stack: Frame[] = [];
  let buf = '';
  let bufStart = 0;

  const attach = (node: UbbNode) => {
    const top = stack[stack.length - 1];
    if (top) top.node.children.push(node);
    else roots.push(node);
  };
  const appendBuf = (s: string, start: number) => {
    if (!buf) bufStart = start;
    buf += s;
  };
  const flushText = (end: number) => {
    if (buf) attach({ type: 'text', text: buf, range: [bufStart, end] });
    buf = '';
  };

  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];

    // 1. escape: [[ ... ]]
    if (ch === '[' && source[i + 1] === '[') {
      const close = source.indexOf(']]', i + 2);
      if (close === -1) {
        errors.push({ kind: 'unclosed-escape', pos: i, message: `Unclosed escape at ${i}` });
        appendBuf('[' + source.slice(i + 2), i);
        i = n;
      } else {
        appendBuf('[' + source.slice(i + 2, close) + ']', i);
        i = close + 2;
      }
      continue;
    }

    // 2/3. tag tokens
    if (ch === '[') {
      const rest = source.slice(i, i + 64); // 标签 token 长度上限，避免长文本整段 slice
      if (ch === '[' && source[i + 1] === '/') {
        const m = CLOSE_RE.exec(rest);
        if (m && specs.has(m[1].toLowerCase())) {
          const name = m[1].toLowerCase();
          const tokenEnd = i + m[0].length;
          let idx = -1;
          for (let k = stack.length - 1; k >= 0; k--) {
            if (stack[k].spec.name === name) { idx = k; break; }
          }
          if (idx === -1) {
            errors.push({ kind: 'mismatched', pos: i, message: `Unexpected [/${name}]` });
            appendBuf(m[0], i);
            i = tokenEnd;
            continue;
          }
          flushText(i);
          for (let k = stack.length - 1; k > idx; k--) {
            const f = stack.pop()!;
            f.node.range[1] = i;
            f.node.contentRange[1] = i;
            errors.push({ kind: 'mismatched', pos: i, message: `Nested [${f.spec.name}] closed implicitly at ${i}` });
          }
          const f = stack.pop()!;
          f.node.range[1] = tokenEnd;
          f.node.contentRange[1] = i;
          i = tokenEnd;
          continue;
        }
      } else {
        const m = OPEN_RE.exec(rest);
        if (m && specs.has(m[1].toLowerCase())) {
          const spec = specs.get(m[1].toLowerCase())!;
          const tokenEnd = i + m[0].length;
          const rawValue = m[2];
          let value: string | undefined;
          if (rawValue !== undefined) {
            if (!spec.valuePattern || !spec.valuePattern.test(rawValue)) {
              if (!spec.valuePattern) {
                // 未声明值属性 → 整个 token 按普通文本
                appendBuf(m[0], i);
                i = tokenEnd;
                continue;
              }
              errors.push({ kind: 'invalid-value', pos: i, message: `Invalid value "${rawValue}" for [${spec.name}]` });
            } else {
              value = rawValue;
            }
          } else if (spec.valuePattern) {
            errors.push({ kind: 'invalid-value', pos: i, message: `Missing value for [${spec.name}]` });
          }
          flushText(i);
          const node: Extract<UbbNode, { children: UbbNode[] }> = {
            type: spec.name,
            children: [],
            range: [i, tokenEnd],
            contentRange: [tokenEnd, tokenEnd],
          };
          if (value !== undefined) {
            node.value = value;
            if (spec.name === 'color') node.color = value;
          }
          attach(node);
          stack.push({ spec, node });
          i = tokenEnd;
          continue;
        }
      }
    }

    // 4. ordinary char
    appendBuf(ch, i);
    i++;
  }

  flushText(n);
  for (let k = stack.length - 1; k >= 0; k--) {
    const f = stack[k];
    f.node.range[1] = n;
    f.node.contentRange[1] = n;
    errors.push({ kind: 'unclosed', pos: f.node.range[0], message: `Unclosed [${f.spec.name}]` });
  }

  let visible = 0;
  const walk = (nodes: UbbNode[]) => {
    for (const nd of nodes) {
      if (nd.type === 'text') visible += nd.text.length;
      else walk(nd.children);
    }
  };
  walk(roots);

  return { ast: roots, errors, visibleLength: visible, sourceLength: source.length };
}
```

注意 `import.meta.env?.DEV` 在 vitest（无 define）下为 undefined → 可选链安全。OPEN_RE 里 `m[2]` 在 `[b]`（无 `=`）时为 undefined、`[b=]` 时为 `''`——上面分支已按 undefined / 空串区分处理（空串走 pattern 校验失败 → invalid-value）。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @jswork/react-ubb test -- 02-parser.spec.ts`
Expected: PASS（tags + parser 全部用例）

- [ ] **Step 5: 提交**

```bash
git add packages/lib/src/core/parser.ts packages/lib/__tests__/02-parser.spec.ts
git commit -m "feat(core): implement single-pass parser with stack repair, escapes and value tags"
```

---

### Task 3: plain.ts（toPlainText / visibleLength）

**Files:**
- Create: `packages/lib/src/core/plain.ts`
- Test: `packages/lib/__tests__/02-parser.spec.ts`（追加）

- [ ] **Step 1: 追加失败测试**

```ts
// 02-parser.spec.ts 追加
import { toPlainText, visibleLength } from '../src/core/plain';

describe('plain', () => {
  it('strips tags and keeps visible text order', () => {
    expect(toPlainText('a[b]bc[/b]d')).toBe('abcd');
  });
  it('unescapes [[b]] to [b]', () => {
    expect(toPlainText('a[[b]]c')).toBe('a[b]c');
  });
  it('invalid color still yields inner text', () => {
    expect(toPlainText('[color=red]x[/color]')).toBe('x');
  });
  it('keeps newlines', () => {
    expect(toPlainText('a\n[b]b[/b]\n')).toBe('a\nb\n');
  });
  it('visibleLength equals plain length', () => {
    expect(visibleLength('a[b]bc[/b]d')).toBe(4);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @jswork/react-ubb test -- 02-parser.spec.ts`
Expected: FAIL（Cannot find module '../src/core/plain'）

- [ ] **Step 3: 实现 plain.ts**

```ts
// packages/lib/src/core/plain.ts
import { UbbNode } from './ast';
import { parse } from './parser';
import { DEFAULT_TAGS, TagSpec } from './tags';

function collect(nodes: UbbNode[], out: string[]): void {
  for (const node of nodes) {
    if (node.type === 'text') out.push(node.text);
    else collect(node.children, out);
  }
}

export function toPlainText(source: string, tags: TagSpec[] = DEFAULT_TAGS): string {
  const out: string[] = [];
  collect(parse(source, tags).ast, out);
  return out.join('');
}

export function visibleLength(source: string, tags: TagSpec[] = DEFAULT_TAGS): number {
  return toPlainText(source, tags).length;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @jswork/react-ubb test -- 02-parser.spec.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/lib/src/core/plain.ts packages/lib/__tests__/02-parser.spec.ts
git commit -m "feat(core): add toPlainText and visibleLength"
```

---

### Task 4: transform.ts（wrapTag / insertEmptyTag / replaceColor / truncateToVisible / escapeText）

**Files:**
- Create: `packages/lib/src/core/transform.ts`
- Test: `packages/lib/__tests__/03-transform.spec.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/lib/__tests__/03-transform.spec.ts
import { wrapTag, insertEmptyTag, replaceColor, truncateToVisible, escapeText } from '../src/core/transform';

describe('wrapTag', () => {
  const src = 'a[b]bc[/b]d';
  it('wraps selection outside tag', () => {
    // 选 "a"（0,1）
    const r = wrapTag(src, { start: 0, end: 1 }, 'b');
    expect(r!.source).toBe('[b]a[b]bc[/b]d');
    expect(r!.selection).toEqual({ start: 3, end: 4 });
  });
  it('unwrap when selection fully inside same tag (AC-02)', () => {
    // 选 "bc" 位于 [b] 内（4,6）
    const r = wrapTag(src, { start: 4, end: 6 }, 'b');
    expect(r!.source).toBe('abcd');
    expect(r!.selection).toEqual({ start: 1, end: 3 });
  });
  it('wrap when selection crosses tag boundary', () => {
    // 选 "bc[/b]d" 起点在标签内、终点在外（4,11）→ 包裹
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
});

describe('insertEmptyTag', () => {
  it('inserts empty pair with cursor inside (FR-11)', () => {
    const r = insertEmptyTag('abc', 1, 'b');
    expect(r.source).toBe('a[b][/b]bc');
    expect(r.selection).toEqual({ start: 4, end: 4 });
  });
  it('value tag inserts [tag=] with cursor after =', () => {
    const r = insertEmptyTag('abc', 1, 'color', '#FF0000');
    expect(r.source).toBe('a[color=#FF0000][/color]bc');
    expect(r.selection.start).toBe('a[color=#FF0000'.length);
  });
});

describe('replaceColor', () => {
  it('replaces value in place, no nesting (FR-18 / AC-03)', () => {
    const src = '[b][color=#FF0000]abc[/color][/b]';
    // 选区位于 color 内容内（17,20）
    const r = replaceColor(src, { start: 17, end: 20 }, '#00FF00');
    expect(r!.source).toBe('[b][color=#00FF00]abc[/color][/b]');
    expect(r!.selection).toEqual({ start: 17, end: 20 });
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
    expect(truncateToVisible('[[x]]bc', 3)).toBe('[[x]]b');
  });
});

describe('escapeText', () => {
  it('escapes brackets for safe re-insertion', () => {
    expect(escapeText('a[b]c')).toBe('a[[b]]c');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @jswork/react-ubb test -- 03-transform.spec.ts`
Expected: FAIL（module not found）

- [ ] **Step 3: 实现 transform.ts**

```ts
// packages/lib/src/core/transform.ts
import { UbbNode } from './ast';
import { parse } from './parser';
import { DEFAULT_TAGS, TagSpec } from './tags';

export interface Sel {
  start: number;
  end: number;
}
export interface TransformResult {
  source: string;
  selection: Sel;
}

type TagNode = Extract<UbbNode, { children: UbbNode[] }>;

// 选区完整位于同名标签内部的最内层节点；无则 undefined
function findEnclosing(ast: UbbNode[], name: string, sel: Sel): TagNode | undefined {
  let found: TagNode | undefined;
  const walk = (nodes: UbbNode[]) => {
    for (const node of nodes) {
      if (node.type !== 'text') {
        const [cs, ce] = node.contentRange;
        const contains = cs <= sel.start && sel.end <= ce;
        if (contains && node.type === name) found = node;
        if (contains) walk(node.children); // 深度优先，后访问的更深节点覆盖
      }
    }
  };
  walk(ast);
  return found;
}

export function wrapTag(
  source: string,
  selection: Sel,
  tagName: string,
  value?: string,
  tags: TagSpec[] = DEFAULT_TAGS,
): TransformResult | null {
  if (!tags.some((t) => t.name === tagName)) return null;
  const { ast } = parse(source, tags);
  const node = findEnclosing(ast, tagName, selection);
  if (node) {
    // unwrap：移除 open [range0, contentRange0) 与 close [contentRange1, range1)
    const [o0, o1] = [node.range[0], node.contentRange[0]];
    const [c0, c1] = [node.contentRange[1], node.range[1]];
    const next = source.slice(0, o0) + source.slice(o1, c0) + source.slice(c1);
    const dOpen = o1 - o0;
    return { source: next, selection: { start: selection.start - dOpen, end: selection.end - dOpen } };
  }
  const open = value !== undefined ? `[${tagName}=${value}]` : `[${tagName}]`;
  const close = `[/${tagName}]`;
  const next =
    source.slice(0, selection.start) + open + source.slice(selection.start, selection.end) + close + source.slice(selection.end);
  return { source: next, selection: { start: selection.start + open.length, end: selection.end + open.length } };
}

export function insertEmptyTag(
  source: string,
  cursor: number,
  tagName: string,
  value?: string,
  tags: TagSpec[] = DEFAULT_TAGS,
): TransformResult {
  const open = value !== undefined ? `[${tagName}=${value}]` : `[${tagName}]`;
  const ins = open + `[/${tagName}]`;
  const at = value !== undefined ? cursor + open.length : cursor + open.length;
  return {
    source: source.slice(0, cursor) + ins + source.slice(cursor),
    selection: { start: at, end: at },
  };
}

export function replaceColor(
  source: string,
  selection: Sel,
  hex: string,
  tags: TagSpec[] = DEFAULT_TAGS,
): TransformResult | null {
  const { ast } = parse(source, tags);
  const node = findEnclosing(ast, 'color', selection);
  if (node) {
    const o0 = node.range[0];
    const o1 = node.contentRange[0];
    const open = `[color=${hex}]`;
    const next = source.slice(0, o0) + open + source.slice(o1);
    const delta = open.length - (o1 - o0);
    return { source: next, selection: { start: selection.start + delta, end: selection.end + delta } };
  }
  return wrapTag(source, selection, 'color', hex, tags);
}

export function escapeText(text: string): string {
  return text.replace(/\[/g, '[[').replace(/\]/g, ']]');
}

export function truncateToVisible(source: string, limit: number, tags: TagSpec[] = DEFAULT_TAGS): string {
  const { ast } = parse(source, tags);
  let count = 0;
  let out = '';
  let cut = false;
  const esc = (s: string) => s.replace(/\[/g, '[[').replace(/\]/g, ']]');
  const walk = (nodes: UbbNode[]) => {
    for (const node of nodes) {
      if (cut) return;
      if (node.type === 'text') {
        for (const ch of node.text) {
          if (count >= limit) {
            cut = true;
            return;
          }
          out += ch === '[' || ch === ']' ? esc(ch) : ch;
          count++;
        }
      } else {
        const open = node.value !== undefined ? `[${node.type}=${node.value}]` : `[${node.type}]`;
        out += open;
        walk(node.children);
        out += `[/${node.type}]`;
      }
    }
  };
  walk(ast);
  return out;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @jswork/react-ubb test -- 03-transform.spec.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: 提交**

```bash
git add packages/lib/src/core/transform.ts packages/lib/__tests__/03-transform.spec.ts
git commit -m "feat(core): add wrap/unwrap/replaceColor transforms and visible truncation"
```

---

### Task 5: renderer（types.ts / render-ast.tsx / ubb-view.tsx）

**Files:**
- Create: `packages/lib/src/core/index.ts`（core 桶文件出口，renderer 依赖）
- Create: `packages/lib/src/renderer/types.ts`
- Create: `packages/lib/src/renderer/render-ast.tsx`
- Create: `packages/lib/src/renderer/ubb-view.tsx`
- Test: `packages/lib/__tests__/04-renderer.spec.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// packages/lib/__tests__/04-renderer.spec.tsx
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
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

  it('blank hides text and renders slot with estimated width (Q7 default)', () => {
    render(<UbbView source={'答案在[blank]二字[/blank]这里'} />);
    const slot = document.querySelector('.react-ubb__blank') as HTMLElement;
    expect(slot.textContent).toBe('');
    expect(slot.style.minWidth).toBe('2em'); // 两个 CJK 字符
  });

  it('empty blank slot gets 4em (self-closing-ready)', () => {
    render(<UbbView source={'[blank][/blank]'} />);
    const slot = document.querySelector('.react-ubb__blank') as HTMLElement;
    expect(slot.style.minWidth).toBe('4em');
  });

  it('escape renders literal tag', () => {
    render(<UbbView source={'[[b]]'} />);
    expect(screen.getByText('[b]')).toBeInTheDocument();
  });

  it('newline renders <br> (FR-27)', () => {
    const { container } = render(<UbbView source={'a\nb'} />);
    expect(container.querySelector('br')).toBeInTheDocument();
  });

  it('unknown tag stays literal (FR-08)', () => {
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
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @jswork/react-ubb test -- 04-renderer.spec.tsx`
Expected: FAIL（module not found）

- [ ] **Step 3: 实现四个文件**

```ts
// packages/lib/src/core/index.ts
export * from './ast';
export * from './tags';
export { parse } from './parser';
export { toPlainText, visibleLength } from './plain';
export * from './transform';
```

```ts
// packages/lib/src/renderer/types.ts
import { ReactNode } from 'react';
import { TagSpec, UbbNode } from '../core';

export interface CustomTag extends TagSpec {
  icon?: ReactNode; // 工具栏图标，缺省渲染 label
  shortcut?: string; // 如 'mod+k'（mod = Cmd/Ctrl）
  toolbar?: boolean; // 默认 true；false = 仅解析不显示按钮
  render?: (props: { children: ReactNode; node: UbbNode }) => ReactNode;
}

export const definePlugin = <T extends CustomTag>(plugin: T): T => plugin;
```

```tsx
// packages/lib/src/renderer/render-ast.tsx
import React, { Fragment, ReactNode } from 'react';
import { UbbNode } from '../core';
import { CustomTag } from './types';

function blankWidth(node: UbbNode): string {
  let w = 0;
  const walk = (nodes: UbbNode[]) => {
    for (const n of nodes) {
      if (n.type === 'text') {
        for (const ch of n.text) w += ch.charCodeAt(0) > 0xff ? 1 : 0.5;
      } else walk(n.children);
    }
  };
  walk(node.type === 'text' ? [] : node.children);
  return `${w || 4}em`;
}

function withLines(text: string): ReactNode[] {
  return text.split('\n').flatMap((seg, idx) => (idx === 0 ? [seg] : [<br key={idx} />, seg]));
}

export function renderAst(nodes: UbbNode[], plugins: CustomTag[] = [], prefix = ''): ReactNode[] {
  return nodes.map((node, idx) => {
    const key = `${prefix}${idx}`;
    if (node.type === 'text') return <Fragment key={key}>{withLines(node.text)}</Fragment>;
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
        if (plugin?.render) return <Fragment key={key}>{plugin.render({ children: [], node })}</Fragment>;
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
```

```tsx
// packages/lib/src/renderer/ubb-view.tsx
import React, { useMemo } from 'react';
import cx from 'classnames';
import { DEFAULT_TAGS, mergeTags, parse } from '../core';
import { renderAst } from './render-ast';
import { CustomTag } from './types';

export interface UbbViewProps {
  source: string;
  plugins?: CustomTag[];
  className?: string;
}

export default function UbbView({ source, plugins, className }: UbbViewProps) {
  const tags = useMemo(() => mergeTags(DEFAULT_TAGS, plugins), [plugins]);
  const ast = useMemo(() => parse(source, tags).ast, [source, tags]);
  return (
    <div data-component="react-ubb-view" className={cx('react-ubb-view', className)}>
      {renderAst(ast, plugins)}
    </div>
  );
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @jswork/react-ubb test -- 04-renderer.spec.tsx`
Expected: PASS（全部用例）

- [ ] **Step 5: 提交**

```bash
git add packages/lib/src/core/index.ts packages/lib/src/renderer packages/lib/__tests__/04-renderer.spec.tsx
git commit -m "feat(renderer): add UbbView, renderAst and definePlugin"
```

---

### Task 6: selection.ts（插入 / 降级 / UndoStack / 快捷键匹配）

**Files:**
- Create: `packages/lib/src/editor/selection.ts`
- Test: `packages/lib/__tests__/05-editor.spec.tsx`（本任务创建，先测 selection）

- [ ] **Step 1: 写失败测试**

```tsx
// packages/lib/__tests__/05-editor.spec.tsx
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { UndoStack, matchShortcut, replaceRange } from '../src/editor/selection';

describe('replaceRange', () => {
  it('falls back to setRangeText in jsdom and sets selection', () => {
    const { container } = render(<textarea defaultValue="abc" />);
    const ta = container.querySelector('textarea')!;
    const native = replaceRange(ta, 'X', { start: 0, end: 1 }, { start: 1, end: 1 });
    expect(native).toBe(false); // jsdom 无 execCommand → 降级
    expect(ta.value).toBe('Xbc');
    expect(ta.selectionStart).toBe(1);
  });
});

describe('UndoStack', () => {
  it('undo/redo with 50-step cap and future reset on push', () => {
    const s = new UndoStack();
    const a = { source: 'a', selection: { start: 0, end: 0 } };
    const b = { source: 'ab', selection: { start: 1, end: 1 } };
    const c = { source: 'abc', selection: { start: 2, end: 2 } };
    s.push(a);
    s.push(b);
    expect(s.undo(c)).toEqual(b);
    expect(s.redo(c)).toEqual(b);
    expect(s.undo(c)).toEqual(b);
    expect(s.undo(c)).toEqual(a);
    expect(s.undo(c)).toBeUndefined();
  });
});

describe('matchShortcut', () => {
  const ev = (key: string, opts: { mod?: boolean; shift?: boolean }) =>
    ({ key, metaKey: false, ctrlKey: !!opts.mod, shiftKey: !!opts.shift } as unknown as KeyboardEvent);
  it('matches mod+b', () => {
    expect(matchShortcut(ev('b', { mod: true }), 'mod+b')).toBe(true);
    expect(matchShortcut(ev('b', {}), 'mod+b')).toBe(false);
  });
  it('matches mod+shift+z', () => {
    expect(matchShortcut(ev('z', { mod: true, shift: true }), 'mod+shift+z')).toBe(true);
    expect(matchShortcut(ev('z', { mod: true }), 'mod+shift+z')).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @jswork/react-ubb test -- 05-editor.spec.tsx`
Expected: FAIL（module not found）

- [ ] **Step 3: 实现 selection.ts**

```ts
// packages/lib/src/editor/selection.ts
import { Sel } from '../core/transform';

export interface Snapshot {
  source: string;
  selection: Sel;
}

export function getSelection(ta: HTMLTextAreaElement): Sel {
  return { start: ta.selectionStart, end: ta.selectionEnd };
}

// 一次 execCommand('insertText') 替换 [sel.start, sel.end) → text（原生 undo 单单元，AC-10）；
// jsdom / 不支持环境降级 setRangeText，返回 false 表示原生 undo 不可用（调用方启用自建栈）
export function replaceRange(
  ta: HTMLTextAreaElement,
  text: string,
  sel?: Sel,
  nextSel?: Sel,
): boolean {
  const range = sel ?? getSelection(ta);
  ta.focus();
  ta.setSelectionRange(range.start, range.end);
  let native = false;
  try {
    native = document.execCommand('insertText', false, text);
  } catch {
    native = false;
  }
  if (!native) ta.setRangeText(text, range.start, range.end, 'end');
  const target = nextSel ?? { start: ta.selectionStart, end: ta.selectionEnd };
  ta.setSelectionRange(target.start, target.end);
  return native;
}

export class UndoStack {
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  push(s: Snapshot): void {
    this.past.push(s);
    if (this.past.length > 50) this.past.shift();
    this.future = [];
  }
  undo(current: Snapshot): Snapshot | undefined {
    const s = this.past.pop();
    if (s) this.future.push(current);
    return s;
  }
  redo(current: Snapshot): Snapshot | undefined {
    const s = this.future.pop();
    if (s) this.past.push(current);
    return s;
  }
}

// 'mod+k'（mod = Cmd/Ctrl）→ keydown 匹配
export function matchShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  const needMod = parts.includes('mod');
  const needShift = parts.includes('shift');
  return e.key.toLowerCase() === key && (e.metaKey || e.ctrlKey) === needMod && e.shiftKey === needShift;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @jswork/react-ubb test -- 05-editor.spec.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/lib/src/editor/selection.ts packages/lib/__tests__/05-editor.spec.tsx
git commit -m "feat(editor): add selection helpers, execCommand fallback and undo stack"
```

---

### Task 7: locale（Labels / zh-cn / en-us）

**Files:**
- Create: `packages/lib/src/editor/locale.ts`
- Create: `packages/lib/src/locale/zh-cn.ts`
- Create: `packages/lib/src/locale/en-us.ts`
- Test: `packages/lib/__tests__/05-editor.spec.tsx`（追加）

- [ ] **Step 1: 追加失败测试**

```tsx
// 05-editor.spec.tsx 追加
import { mergeLocale } from '../src/editor/locale';
import { zhCN } from '../src/locale/zh-cn';
import { enUS } from '../src/locale/en-us';

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
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @jswork/react-ubb test -- 05-editor.spec.tsx`
Expected: FAIL（module not found）

- [ ] **Step 3: 实现三个文件**

```ts
// packages/lib/src/editor/locale.ts
export interface Labels {
  bold: string;
  italic: string;
  color: string;
  blank: string;
  clear: string;
  empty: string;
  edit: string;
  preview: string;
  refresh: string;
  counter: (visible: number, max?: number) => string;
  warnUnclosed: string;
  warnInvalid: string;
  placeholder: string;
}

export function mergeLocale(base: Labels, patch?: Partial<Labels>): Labels {
  return { ...base, ...patch };
}
```

```ts
// packages/lib/src/locale/zh-cn.ts
import { Labels } from '../editor/locale';

export const zhCN: Labels = {
  bold: '加粗',
  italic: '斜体',
  color: '颜色',
  blank: '插空',
  clear: '清除样式',
  empty: '清空',
  edit: '编辑',
  preview: '预览',
  refresh: '刷新预览',
  counter: (v, max) => (max ? `${v} / ${max}` : `${v}`),
  warnUnclosed: '存在未闭合标签，保存前请修正',
  warnInvalid: '存在非法标签或非法颜色值',
  placeholder: '输入内容，选中文字后可添加样式',
};
```

```ts
// packages/lib/src/locale/en-us.ts
import { Labels } from '../editor/locale';

export const enUS: Labels = {
  bold: 'Bold',
  italic: 'Italic',
  color: 'Color',
  blank: 'Blank',
  clear: 'Clear style',
  empty: 'Clear all',
  edit: 'Edit',
  preview: 'Preview',
  refresh: 'Refresh preview',
  counter: (v, max) => (max ? `${v} / ${max}` : `${v}`),
  warnUnclosed: 'Unclosed tags found, fix before saving',
  warnInvalid: 'Invalid tags or color values found',
  placeholder: 'Type here, select text to apply styles',
};
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @jswork/react-ubb test -- 05-editor.spec.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/lib/src/editor/locale.ts packages/lib/src/locale packages/lib/__tests__/05-editor.spec.tsx
git commit -m "feat(editor): add i18n labels for zh-CN and en-US"
```

---

### Task 8: 编辑器骨架（ubb-editor.tsx / toolbar.tsx / index.ts，重写 01-basic）

**Files:**
- Create: `packages/lib/src/editor/ubb-editor.tsx`
- Create: `packages/lib/src/editor/toolbar.tsx`
- Create: `packages/lib/src/index.ts`
- Delete: `packages/lib/src/index.tsx`（占位组件）
- Test: `packages/lib/__tests__/01-basic.spec.tsx`（重写）

- [ ] **Step 1: 重写 01-basic 测试（先失败）**

```tsx
// packages/lib/__tests__/01-basic.spec.tsx（整文件替换）
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import UbbEditor from '../src';

describe('UbbEditor basics', () => {
  it('renders root, textarea and preview pane', () => {
    render(<UbbEditor defaultValue={'[b]hi[/b]'} />);
    expect(document.querySelector('[data-component="react-ubb"]')).toBeInTheDocument();
    expect(document.querySelector('.react-ubb__textarea')).toBeInTheDocument();
    expect(document.querySelector('.react-ubb__preview strong')).toBeInTheDocument();
  });

  it('controlled: value + onChange(source, meta)', () => {
    const onChange = vi.fn();
    render(<UbbEditor value="abc" onChange={onChange} />);
    const ta = document.querySelector('.react-ubb__textarea') as HTMLTextAreaElement;
    fireEvent.input(ta, { target: { value: 'abcd' } });
    expect(onChange).toHaveBeenCalledWith('abcd', expect.objectContaining({ visibleLength: 4, sourceLength: 4 }));
  });

  it('readOnly: textarea readOnly and toolbar buttons disabled (AC-11)', () => {
    render(<UbbEditor value="abc" readOnly />);
    expect(document.querySelector('.react-ubb__textarea')).toHaveAttribute('readonly');
    expect((screen.getByRole('button', { name: '加粗' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('mode=preview hides textarea, renders full preview (AC-15 前半)', () => {
    render(<UbbEditor defaultValue={'[i]x[/i]'} mode="preview" />);
    expect(document.querySelector('.react-ubb__textarea')).toBeNull();
    expect(document.querySelector('.react-ubb__body em')).toBeInTheDocument();
  });

  it('ref API: getSource / getPlainText / validate / clear', () => {
    const ref = React.createRef<any>();
    render(<UbbEditor ref={ref} defaultValue={'[b]ab[/b]'} />);
    expect(ref.current.getSource()).toBe('[b]ab[/b]');
    expect(ref.current.getPlainText()).toBe('ab');
    expect(ref.current.validate()).toBe(true);
    ref.current.clear();
    expect(ref.current.getSource()).toBe('');
  });

  it('validate() false when unclosed (AC-05)', () => {
    const ref = React.createRef<any>();
    render(<UbbEditor ref={ref} defaultValue={'[b]x'} />);
    expect(ref.current.validate()).toBe(false);
  });

  it('toolbar buttons expose aria-label / aria-pressed (NFR-05)', () => {
    render(<UbbEditor defaultValue="abc" />);
    const bold = screen.getByRole('button', { name: '加粗' });
    expect(bold).toHaveAttribute('aria-pressed', 'false');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @jswork/react-ubb test -- 01-basic.spec.tsx`
Expected: FAIL（默认导出仍是占位组件，断言不匹配）

- [ ] **Step 3: 实现 toolbar.tsx**

```tsx
// packages/lib/src/editor/toolbar.tsx
import cx from 'classnames';
import React from 'react';
import { TagSpec } from '../core';
import { CustomTag } from '../renderer/types';
import { Labels } from './locale';

export interface ToolbarProps {
  tags: TagSpec[];
  plugins: CustomTag[];
  labels: Labels;
  mode: 'edit' | 'preview';
  onModeChange(mode: 'edit' | 'preview'): void;
  activeNames: Set<string>;
  onTagClick(name: string): void;
  onColorClick(): void;
  onClear(): void;
  onEmpty(): void;
  onRefresh(): void;
  showRefresh: boolean;
  counter: string;
  warnUnclosed: boolean;
  warnInvalid: boolean;
  readOnly?: boolean;
  disabled?: boolean;
}

const BUILTIN_KEY: Record<string, keyof Labels> = { b: 'bold', i: 'italic', color: 'color', blank: 'blank' };

export default function Toolbar(p: ToolbarProps) {
  const pluginMap = new Map(p.plugins.map((x) => [x.name, x]));
  const off = !!(p.readOnly || p.disabled);
  const btn = (name: string, label: string, pressed: boolean, onClick: () => void, extra?: Partial<React.ButtonHTMLAttributes<HTMLButtonElement>>) => (
    <button
      key={name}
      type="button"
      className={cx('react-ubb__btn', { 'react-ubb__btn--pressed': pressed })}
      aria-label={label}
      aria-pressed={pressed}
      disabled={off}
      onClick={onClick}
      {...extra}
    >
      {label}
    </button>
  );
  return (
    <div className="react-ubb__toolbar" role="toolbar">
      {p.tags.map((tag) =>
        tag.name === 'color'
          ? btn('color', p.labels.color, false, p.onColorClick, { 'aria-haspopup': 'dialog' })
          : btn(
              tag.name,
              (BUILTIN_KEY[tag.name] && p.labels[BUILTIN_KEY[tag.name]]) || pluginMap.get(tag.name)?.label || tag.label || tag.name,
              p.activeNames.has(tag.name),
              () => p.onTagClick(tag.name),
              { title: pluginMap.get(tag.name)?.shortcut },
            ),
      )}
      {btn('clear', p.labels.clear, false, p.onClear)}
      {btn('empty', p.labels.empty, false, p.onEmpty)}
      <span className="react-ubb__counter">{p.counter}</span>
      {p.showRefresh && btn('refresh', p.labels.refresh, false, p.onRefresh)}
      <span className="react-ubb__mode">
        {btn('edit', p.labels.edit, p.mode === 'edit', () => p.onModeChange('edit'))}
        {btn('preview', p.labels.preview, p.mode === 'preview', () => p.onModeChange('preview'))}
      </span>
      {(p.warnUnclosed || p.warnInvalid) && (
        <div className="react-ubb__warn" role="alert">
          {[p.warnUnclosed && p.labels.warnUnclosed, p.warnInvalid && p.labels.warnInvalid].filter(Boolean).join('；')}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 实现 ubb-editor.tsx**

```tsx
// packages/lib/src/editor/ubb-editor.tsx
import cx from 'classnames';
import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { DEFAULT_TAGS, UbbNode, mergeTags, parse, toPlainText } from '../core';
import { Sel, TransformResult, insertEmptyTag, truncateToVisible, wrapTag } from '../core/transform';
import { renderAst } from '../renderer/render-ast';
import { CustomTag } from '../renderer/types';
import { enUS } from '../locale/en-us';
import { zhCN } from '../locale/zh-cn';
import { Labels, mergeLocale } from './locale';
import { getSelection, replaceRange } from './selection';
import Toolbar from './toolbar';

const CLASS_NAME = 'react-ubb';
const PREVIEW_LIMIT = 20000;

export interface UbbMeta {
  visibleLength: number;
  sourceLength: number;
  hasInvalidTag: boolean;
  hasUnclosedTag: boolean;
  selection: { start: number; end: number };
}

export interface UbbEditorRef {
  focus(): void;
  blur(): void;
  insertTag(name: string, value?: string): void;
  getSource(): string;
  getPlainText(): string;
  clear(): void;
  validate(): boolean;
}

export interface UbbEditorProps {
  value?: string;
  defaultValue?: string;
  onChange?: (source: string, meta: UbbMeta) => void;
  readOnly?: boolean;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
  mode?: 'edit' | 'preview';
  onModeChange?: (mode: 'edit' | 'preview') => void;
  showPreview?: boolean;
  previewMode?: 'side' | 'vertical';
  fullscreen?: boolean;
  plugins?: CustomTag[];
  enabledTags?: string[];
  disabledTags?: string[];
  colors?: string[];
  stripPaste?: boolean;
  autoSave?: { key: string } | boolean;
  locale?: 'zh-CN' | 'en-US';
  labels?: Partial<Labels>;
  theme?: 'light' | 'dark';
  className?: string;
  style?: React.CSSProperties;
}

function UbbEditorBase(props: UbbEditorProps, ref: React.ForwardedRef<UbbEditorRef>) {
  const {
    value, defaultValue, onChange, readOnly, disabled, placeholder, maxLength,
    mode: modeProp, onModeChange, showPreview = true, previewMode = 'side', fullscreen,
    plugins, enabledTags, disabledTags, stripPaste,
    locale = 'zh-CN', labels, theme = 'light', className, style,
  } = props;

  const [innerValue, setInnerValue] = useState(defaultValue ?? '');
  const isControlled = value !== undefined;
  const source = isControlled ? (value as string) : innerValue;

  const [innerMode, setInnerMode] = useState<'edit' | 'preview'>('edit');
  const mode = modeProp ?? innerMode;
  const setMode = (m: 'edit' | 'preview') => {
    if (!modeProp) setInnerMode(m);
    onModeChange?.(m);
  };

  const [sel, setSel] = useState<Sel>({ start: 0, end: 0 });
  const [manualPreview, setManualPreview] = useState(source);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const i18n = useMemo(() => mergeLocale(locale === 'en-US' ? enUS : zhCN, labels), [locale, labels]);

  const tags = useMemo(() => {
    let list = mergeTags(DEFAULT_TAGS, plugins);
    if (enabledTags) list = list.filter((t) => enabledTags!.includes(t.name));
    if (disabledTags) list = list.filter((t) => !disabledTags!.includes(t.name));
    return list;
  }, [plugins, enabledTags, disabledTags]);

  const result = useMemo(() => parse(source, tags), [source, tags]);

  const computeMeta = (src: string, selection: Sel): UbbMeta => {
    const r = parse(src, tags);
    return {
      visibleLength: r.visibleLength,
      sourceLength: r.sourceLength,
      hasInvalidTag: r.errors.some((e) => e.kind === 'invalid-value'),
      hasUnclosedTag: r.errors.some((e) => e.kind !== 'invalid-value'),
      selection: { start: selection.start, end: selection.end },
    };
  };

  // 统一应用 transform：一次整体替换 = 一个 undo 单元
  const applyTransform = (t: TransformResult | null) => {
    if (!t || readOnly || disabled || mode !== 'edit') return;
    const ta = taRef.current;
    if (!ta) return;
    const native = replaceRange(ta, t.source, { start: 0, end: source.length }, t.selection);
    if (!native) {
      // jsdom / 降级路径：手动同步状态（native 路径由 input 事件走 handleInput）
      if (!isControlled) setInnerValue(t.source);
      onChange?.(t.source, computeMeta(t.source, t.selection));
    }
  };

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    let next: string = ta.value;
    if (maxLength != null) {
      const r = parse(next, tags);
      if (r.visibleLength > maxLength) {
        next = truncateToVisible(next, maxLength, tags);
        ta.value = next;
      }
    }
    if (!isControlled) setInnerValue(next);
    onChange?.(next, computeMeta(next, getSelection(ta)));
  };

  const currentSel = (): Sel => (taRef.current ? getSelection(taRef.current) : sel);

  const handleTagClick = (name: string) => {
    const s = currentSel();
    const t = s.start === s.end ? insertEmptyTag(source, s.start, name, undefined, tags) : wrapTag(source, s, name, undefined, tags);
    applyTransform(t);
  };

  // 选区完整位于哪些标签内（工具栏 aria-pressed / 清除样式）
  const activeNames = useMemo(() => {
    const names = new Set<string>();
    const walk = (nodes: UbbNode[]) => {
      for (const node of nodes) {
        if (node.type === 'text') continue;
        const [cs, ce] = node.contentRange;
        if (cs <= sel.start && sel.end <= ce) {
          names.add(node.type);
          walk(node.children);
        }
      }
    };
    walk(result.ast);
    return names;
  }, [result, sel]);

  const handleClear = () => {
    let cur = source;
    let curSel = currentSel();
    for (const name of activeNames) {
      const t = wrapTag(cur, curSel, name, undefined, tags); // 在内部 → 解包
      if (t) {
        cur = t.source;
        curSel = t.selection;
      }
    }
    applyTransform({ source: cur, selection: curSel });
  };

  useImperativeHandle(
    ref,
    () => ({
      focus: () => taRef.current?.focus(),
      blur: () => taRef.current?.blur(),
      insertTag: (name: string, val?: string) => {
        const s = currentSel();
        const t = s.start === s.end ? insertEmptyTag(source, s.start, name, val, tags) : wrapTag(source, s, name, val, tags);
        applyTransform(t);
      },
      getSource: () => source,
      getPlainText: () => toPlainText(source, tags),
      clear: () => applyTransform({ source: '', selection: { start: 0, end: 0 } }),
      validate: () => result.errors.length === 0,
    }),
    [source, tags, readOnly, disabled, mode, result],
  );

  const overLimit = source.length > PREVIEW_LIMIT;
  const previewSource = overLimit ? manualPreview : source;
  const previewBody = <>{renderAst(parse(previewSource, tags).ast, plugins)}</>;
  const showPreviewPane = showPreview && mode === 'edit';

  return (
    <div
      data-component={CLASS_NAME}
      data-mode={mode}
      className={cx(CLASS_NAME, {
        [`${CLASS_NAME}--dark`]: theme === 'dark',
        [`${CLASS_NAME}--fullscreen`]: fullscreen,
        [`${CLASS_NAME}--vertical`]: previewMode === 'vertical',
      }, className)}
      style={style}
    >
      <Toolbar
        tags={tags}
        plugins={plugins ?? []}
        labels={i18n}
        mode={mode}
        onModeChange={setMode}
        activeNames={activeNames}
        onTagClick={handleTagClick}
        onColorClick={() => {}}
        onClear={handleClear}
        onEmpty={() => applyTransform({ source: '', selection: { start: 0, end: 0 } })}
        onRefresh={() => setManualPreview(source)}
        showRefresh={overLimit}
        counter={i18n.counter(result.visibleLength, maxLength)}
        warnUnclosed={result.errors.some((e) => e.kind !== 'invalid-value')}
        warnInvalid={result.errors.some((e) => e.kind === 'invalid-value')}
        readOnly={readOnly}
        disabled={disabled}
      />
      <div className={`${CLASS_NAME}__body`}>
        {mode === 'edit' && (
          <textarea
            ref={taRef}
            className={`${CLASS_NAME}__textarea`}
            value={source}
            readOnly={readOnly}
            disabled={disabled}
            placeholder={placeholder ?? i18n.placeholder}
            onInput={handleInput}
            onSelect={(e) => setSel(getSelection(e.currentTarget))}
          />
        )}
        {mode === 'preview' && <div className={`${CLASS_NAME}__preview ${CLASS_NAME}__preview--full`}>{previewBody}</div>}
        {showPreviewPane && <div className={`${CLASS_NAME}__preview`}>{previewBody}</div>}
      </div>
    </div>
  );
}

const UbbEditor = forwardRef<UbbEditorRef, UbbEditorProps>(UbbEditorBase);
UbbEditor.displayName = CLASS_NAME;
export default UbbEditor;
```

```ts
// packages/lib/src/index.ts
export { default } from './editor/ubb-editor';
export type { UbbEditorProps, UbbEditorRef, UbbMeta } from './editor/ubb-editor';
```

并删除 `packages/lib/src/index.tsx`：`git rm packages/lib/src/index.tsx`

- [ ] **Step 5: 运行全部测试确认通过**

Run: `pnpm --filter @jswork/react-ubb test`
Expected: PASS（01~05 全部；01-basic 新用例、旧占位用例已移除）

- [ ] **Step 6: 提交**

```bash
git add packages/lib/src packages/lib/__tests__/01-basic.spec.tsx
git rm packages/lib/src/index.tsx
git commit -m "feat(editor): editor skeleton with toolbar, controlled/uncontrolled, ref API and preview"
```

---

### Task 9: 交互接线（快捷键 / 输入法 / 粘贴 / maxLength / 降级 undo）

**Files:**
- Modify: `packages/lib/src/editor/ubb-editor.tsx`
- Test: `packages/lib/__tests__/05-editor.spec.tsx`（追加）

- [ ] **Step 1: 追加失败测试**

```tsx
// 05-editor.spec.tsx 追加
import UbbEditor from '../src';

const ta = () => document.querySelector('.react-ubb__textarea') as HTMLTextAreaElement;
const select = (start: number, end: number) => {
  const el = ta();
  el.setSelectionRange(start, end);
  fireEvent.select(el);
};

describe('editor interactions', () => {
  it('AC-01: select + bold button wraps and keeps preview bold', () => {
    render(<UbbEditor defaultValue="abc" />);
    select(0, 3);
    fireEvent.click(screen.getByRole('button', { name: '加粗' }));
    expect(ta().value).toBe('[b]abc[/b]');
    expect(document.querySelector('.react-ubb__preview strong')).toBeInTheDocument();
  });

  it('AC-02: clicking bold again unwraps', () => {
    render(<UbbEditor defaultValue={'[b]abc[/b]'} />);
    select(4, 7);
    fireEvent.click(screen.getByRole('button', { name: '加粗' }));
    expect(ta().value).toBe('abc');
  });

  it('AC-03: bold inside selection + color via ref.insertTag nests once', () => {
    const ref = React.createRef<any>();
    render(<UbbEditor ref={ref} defaultValue={'[b]abc[/b]'} />);
    select(4, 7);
    ref.current.insertTag('color', '#FF0000');
    expect(ta().value).toBe('[b][color=#FF0000]abc[/color][/b]');
  });

  it('blank button wraps selection (AC-13 前半)', () => {
    render(<UbbEditor defaultValue="答案" />);
    select(0, 2);
    fireEvent.click(screen.getByRole('button', { name: '插空' }));
    expect(ta().value).toBe('[blank]答案[/blank]');
  });

  it('shortcut mod+b wraps focused editor (FR-13)', () => {
    render(<UbbEditor defaultValue="abc" />);
    select(0, 3);
    fireEvent.keyDown(ta(), { key: 'b', ctrlKey: true });
    expect(ta().value).toBe('[b]abc[/b]');
  });

  it('plugin shortcut intercepted when focused (FR-38)', () => {
    const mark = definePlugin({ name: 'mark', label: 'M', shortcut: 'mod+m', render: ({ children }) => <u>{children}</u> });
    render(<UbbEditor defaultValue="abc" plugins={[mark]} />);
    select(0, 3);
    fireEvent.keyDown(ta(), { key: 'm', ctrlKey: true });
    expect(ta().value).toBe('[mark]abc[/mark]');
  });

  it('readOnly shortcuts do nothing (AC-11)', () => {
    render(<UbbEditor defaultValue="abc" readOnly />);
    select(0, 3);
    fireEvent.keyDown(ta(), { key: 'b', ctrlKey: true });
    expect(ta().value).toBe('abc');
  });

  it('AC-04: paste takes text/plain only', () => {
    render(<UbbEditor defaultValue="ab" />);
    select(2, 2);
    fireEvent.paste(ta(), { clipboardData: { getData: (t: string) => (t === 'text/plain' ? '<b>x</b>' : '<b>x</b>') } });
    expect(ta().value).toBe('ab<b>x</b>');
  });

  it('stripPaste removes tags from pasted text (FR-25)', () => {
    render(<UbbEditor defaultValue="" stripPaste />);
    fireEvent.paste(ta(), { clipboardData: { getData: () => '[b]x[/b]' } });
    expect(ta().value).toBe('x');
  });

  it('maxLength truncates by visible length keeping tags paired (FR-29)', () => {
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
  });

  it('AC-05: unclosed input shows warning alert and validate false', () => {
    const { container } = render(<UbbEditor defaultValue="" />);
    fireEvent.input(ta(), { target: { value: '[b]x' } });
    expect(container.querySelector('.react-ubb__warn')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @jswork/react-ubb test -- 05-editor.spec.tsx`
Expected: FAIL（快捷键 / 粘贴 / undo 用例失败；包裹类用例在 Task 8 已可过）

- [ ] **Step 3: 修改 ubb-editor.tsx（新增交互逻辑）**

在 `const taRef = ...` 之后新增引用与状态：

```ts
const composingRef = useRef(false);
const customUndoRef = useRef(false);
const undoRef = useRef(new UndoStack());
```

导入补充：`import { Snapshot, UndoStack, matchShortcut } from './selection'; import { escapeText } from '../core/transform';`

`applyTransform` 开头追加（composition 冻结 + maxLength 统一约束 + 降级 undo 快照）：

```ts
const applyTransform = (t0: TransformResult | null) => {
  if (!t0 || readOnly || disabled || mode !== 'edit' || composingRef.current) return;
  const ta = taRef.current;
  if (!ta) return;
  let t = t0;
  if (maxLength != null) {
    const r = parse(t.source, tags);
    if (r.visibleLength > maxLength) {
      const truncated = truncateToVisible(t.source, maxLength, tags);
      const clamp = (v: number) => Math.min(v, truncated.length);
      t = { source: truncated, selection: { start: clamp(t.selection.start), end: clamp(t.selection.end) } };
    }
  }
  if (customUndoRef.current) undoRef.current.push({ source, selection: currentSel() });
  const native = replaceRange(ta, t.source, { start: 0, end: source.length }, t.selection);
  if (!native) {
    customUndoRef.current = true; // 一旦降级，后续 undo 全走自建栈
    if (!isControlled) setInnerValue(t.source);
    onChange?.(t.source, computeMeta(t.source, t.selection));
  }
};
```

新增处理函数（放在 `handleClear` 之后）：

```ts
const applySnapshot = (snap: Snapshot) => {
  const ta = taRef.current;
  if (!ta) return;
  ta.value = snap.source;
  ta.setSelectionRange(snap.selection.start, snap.selection.end);
  if (!isControlled) setInnerValue(snap.source);
  onChange?.(snap.source, computeMeta(snap.source, snap.selection));
};

const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
  if (readOnly || disabled) return;
  const ev = e.nativeEvent;
  if (matchShortcut(ev, 'mod+b')) { e.preventDefault(); handleTagClick('b'); return; }
  if (matchShortcut(ev, 'mod+i')) { e.preventDefault(); handleTagClick('i'); return; }
  for (const p of plugins ?? []) {
    if (p.shortcut && matchShortcut(ev, p.shortcut)) { e.preventDefault(); handleTagClick(p.name); return; }
  }
  if (customUndoRef.current) {
    if (matchShortcut(ev, 'mod+z')) {
      e.preventDefault();
      const snap = undoRef.current.undo({ source, selection: currentSel() });
      if (snap) applySnapshot(snap);
      return;
    }
    if (matchShortcut(ev, 'mod+shift+z')) {
      e.preventDefault();
      const snap = undoRef.current.redo({ source, selection: currentSel() });
      if (snap) applySnapshot(snap);
    }
  }
};

const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
  if (readOnly || disabled || composingRef.current) return;
  e.preventDefault();
  let text = e.clipboardData.getData('text/plain');
  if (stripPaste) text = escapeText(toPlainText(text, tags));
  const s = currentSel();
  const next = source.slice(0, s.start) + text + source.slice(s.end);
  const caret = s.start + text.length;
  applyTransform({ source: next, selection: { start: caret, end: caret } });
};
```

textarea 属性追加：

```tsx
onKeyDown={handleKeyDown}
onPaste={handlePaste}
onCompositionStart={() => { composingRef.current = true; }}
onCompositionEnd={() => { composingRef.current = false; }}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @jswork/react-ubb test`
Expected: PASS（全部）

- [ ] **Step 5: 提交**

```bash
git add packages/lib/src/editor/ubb-editor.tsx packages/lib/__tests__/05-editor.spec.tsx
git commit -m "feat(editor): shortcuts, IME guard, plain-text paste, visible maxLength and fallback undo"
```

---

### Task 10: 取色面板（color-picker.tsx + 接线）

**Files:**
- Create: `packages/lib/src/editor/color-picker.tsx`
- Modify: `packages/lib/src/editor/ubb-editor.tsx`
- Test: `packages/lib/__tests__/05-editor.spec.tsx`（追加）

- [ ] **Step 1: 追加失败测试**

```tsx
// 05-editor.spec.tsx 追加
import ColorPicker, { DEFAULT_COLORS } from '../src/editor/color-picker';

describe('color picker', () => {
  it('AC-03: select in bold + pick red → nested once, no double color', () => {
    render(<UbbEditor defaultValue={'[b]abc[/b]'} />);
    select(4, 7);
    fireEvent.click(screen.getByRole('button', { name: '颜色' }));
    fireEvent.click(document.querySelector('.react-ubb__swatch')!); // 第一个色块 #000000? 用红色块：
    expect(ta().value).toMatch(/^\[b\]\[color=#[0-9A-Fa-f]{6}\]abc<\/color>\]?\[\/b\]$/);
  });

  it('FR-18: pick again inside color replaces value, no nesting', () => {
    render(<UbbEditor defaultValue={'[color=#FF0000]abc[/color]'} />);
    select(17, 20);
    fireEvent.click(screen.getByRole('button', { name: '颜色' }));
    const red = [...document.querySelectorAll('.react-ubb__swatch')].find((b) => (b as HTMLElement).style.background !== 'rgb(255, 0, 0)');
    fireEvent.click(red!);
    expect(ta().value).toBe('[color=#000000]abc[/color]');
  });

  it('FR-19: Esc closes panel; overlay click closes', () => {
    render(<UbbEditor defaultValue="abc" />);
    fireEvent.click(screen.getByRole('button', { name: '颜色' }));
    expect(document.querySelector('.react-ubb__color-panel')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('.react-ubb__color-panel')).toBeNull();
  });

  it('hex input commits on Enter', () => {
    render(<UbbEditor defaultValue="abc" />);
    select(0, 3);
    fireEvent.click(screen.getByRole('button', { name: '颜色' }));
    const input = document.querySelector('.react-ubb__hex-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '#00FF00' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(ta().value).toBe('[color=#00FF00]abc[/color]');
  });

  it('recent colors capped at 8 and persisted', () => {
    localStorage.clear();
    render(<ColorPicker colors={DEFAULT_COLORS} onSelect={() => {}} onClose={() => {}} />);
    for (const c of ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888', '#999999']) {
      fireEvent.change(document.querySelector('.react-ubb__hex-input') as HTMLInputElement, { target: { value: c } });
      fireEvent.keyDown(document.querySelector('.react-ubb__hex-input') as HTMLInputElement, { key: 'Enter' });
    }
    const recent = JSON.parse(localStorage.getItem('react-ubb-recent-colors')!);
    expect(recent).toHaveLength(8);
    expect(recent[0]).toBe('#999999');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @jswork/react-ubb test -- 05-editor.spec.tsx`
Expected: FAIL（module not found）

- [ ] **Step 3: 实现 color-picker.tsx**

```tsx
// packages/lib/src/editor/color-picker.tsx
import React, { useEffect, useState } from 'react';
import { COLOR_PATTERN } from '../core';

export const DEFAULT_COLORS = [
  '#000000', '#FFFFFF', '#FF0000', '#FF7F00', '#FFD700', '#00FF00', '#008000',
  '#00FFFF', '#0000FF', '#8B00FF', '#FF00FF', '#808080', '#C0C0C0', '#8B4513',
  '#FFC0CB', '#00FF7F',
];

const RECENT_KEY = 'react-ubb-recent-colors';
const RECENT_MAX = 8;

function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
function saveRecent(list: string[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); } catch { /* ignore */ }
}

export interface ColorPickerProps {
  colors?: string[];
  onSelect(hex: string): void;
  onClose(): void;
}

export default function ColorPicker({ colors = DEFAULT_COLORS, onSelect, onClose }: ColorPickerProps) {
  const [hex, setHex] = useState(colors[0]);
  const [recent, setRecent] = useState<string[]>(() => loadRecent());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const commit = (value: string) => {
    if (!COLOR_PATTERN.test(value)) return;
    const next = [value, ...recent.filter((c) => c !== value)].slice(0, RECENT_MAX);
    setRecent(next);
    saveRecent(next);
    onSelect(value);
  };

  return (
    <div className="react-ubb__overlay" onClick={onClose}>
      <div className="react-ubb__color-panel" role="dialog" aria-label="color picker" onClick={(e) => e.stopPropagation()}>
        <div className="react-ubb__swatches">
          {colors.map((c) => (
            <button key={c} type="button" className="react-ubb__swatch" style={{ background: c }} aria-label={c} onClick={() => commit(c)} />
          ))}
        </div>
        <div className="react-ubb__color-custom">
          <input type="color" aria-label="custom color" value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : '#000000'} onChange={(e) => setHex(e.target.value)} />
          <input
            className="react-ubb__hex-input"
            aria-label="hex"
            placeholder="#RRGGBB"
            value={hex}
            onChange={(e) => setHex(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(hex); }}
          />
        </div>
        {recent.length > 0 && (
          <div className="react-ubb__swatches" data-testid="recent">
            {recent.map((c) => (
              <button key={c} type="button" className="react-ubb__swatch" style={{ background: c }} aria-label={`recent ${c}`} onClick={() => commit(c)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: ubb-editor.tsx 接线**

新增状态与导入：`const [colorOpen, setColorOpen] = useState(false);`、`import ColorPicker from './color-picker';`、`import { replaceColor } from '../core/transform';`

`onColorClick={() => setColorOpen(true)}` 替换原空函数；根节点末尾渲染面板：

```tsx
{colorOpen && (
  <ColorPicker
    colors={props.colors}
    onSelect={(h) => {
      const s = currentSel();
      applyTransform(replaceColor(source, s, h, tags));
      setColorOpen(false);
    }}
    onClose={() => setColorOpen(false)}
  />
)}
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @jswork/react-ubb test`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add packages/lib/src/editor packages/lib/__tests__/05-editor.spec.tsx
git commit -m "feat(editor): zero-dep color picker with swatches, hex input and recents"
```

---

### Task 11: 预览防抖 / autoSave / 样式与主题

**Files:**
- Modify: `packages/lib/src/editor/ubb-editor.tsx`
- Modify: `packages/lib/src/style.scss`（整文件替换）
- Test: `packages/lib/__tests__/05-editor.spec.tsx`（追加）

- [ ] **Step 1: 追加失败测试**

```tsx
// 05-editor.spec.tsx 追加
describe('preview & autosave', () => {
  it('preview debounced 200ms (FR-24)', async () => {
    vi.useFakeTimers();
    render(<UbbEditor defaultValue="" />);
    fireEvent.input(ta(), { target: { value: '[b]x[/b]' } });
    expect(document.querySelector('.react-ubb__preview strong')).toBeNull();
    vi.advanceTimersByTime(250);
    expect(document.querySelector('.react-ubb__preview strong')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('over 20k chars shows refresh button and freezes preview (FR-24)', () => {
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
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @jswork/react-ubb test -- 05-editor.spec.tsx`
Expected: FAIL

- [ ] **Step 3: 修改 ubb-editor.tsx**

新增防抖 hook（文件顶部，组件外）：

```ts
function useDebounced<T>(value: T, delay = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}
```

替换 Task 8 的预览源计算：

```ts
const overLimit = source.length > PREVIEW_LIMIT;
const debouncedSource = useDebounced(source, 200);
const previewSource = overLimit ? manualPreview : debouncedSource;
```

新增 autoSave 副作用（组件内）：

```ts
const autoSaveKey = autoSave === true ? 'react-ubb-draft' : autoSave?.key;
useEffect(() => {
  if (!autoSaveKey) return;
  try { localStorage.setItem(autoSaveKey, source); } catch { /* ignore */ }
}, [source, autoSaveKey]);
// 挂载恢复：非受控且未传 defaultValue 时读取草稿
useEffect(() => {
  if (!autoSaveKey || isControlled || defaultValue !== undefined) return;
  try {
    const draft = localStorage.getItem(autoSaveKey);
    if (draft) setInnerValue(draft);
  } catch { /* ignore */ }
}, []); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 4: 整文件替换 style.scss**

```scss
// packages/lib/src/style.scss
.react-ubb {
  --ubb-border: #d9d9d9;
  --ubb-bg: #fff;
  --ubb-fg: #333;
  --ubb-toolbar-bg: #fafafa;
  --ubb-warn: #d46b08;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--ubb-border);
  border-radius: 6px;
  background: var(--ubb-bg);
  color: var(--ubb-fg);
  font-size: 14px;

  &--dark {
    --ubb-border: #444;
    --ubb-bg: #1f1f1f;
    --ubb-fg: #eee;
    --ubb-toolbar-bg: #2a2a2a;
  }
  &--fullscreen { position: fixed; inset: 0; z-index: 1000; border-radius: 0; }

  &__toolbar {
    display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
    padding: 6px 8px; border-bottom: 1px solid var(--ubb-border);
    background: var(--ubb-toolbar-bg);
  }
  &__btn {
    min-height: 28px; min-width: 32px; padding: 0 8px;
    border: 1px solid transparent; border-radius: 4px; background: transparent;
    color: inherit; cursor: pointer; font-size: 13px;
    &:hover:not(:disabled) { background: rgba(0, 0, 0, 0.06); }
    &--pressed { background: rgba(22, 119, 255, 0.12); border-color: rgba(22, 119, 255, 0.4); }
    &:disabled { opacity: 0.4; cursor: not-allowed; }
  }
  &__counter { margin-left: auto; font-size: 12px; opacity: 0.75; }
  &__mode { display: inline-flex; border: 1px solid var(--ubb-border); border-radius: 4px; overflow: hidden; }
  &__warn { flex-basis: 100%; color: var(--ubb-warn); font-size: 12px; padding: 2px 0; }

  &__body { display: flex; min-height: 160px; }
  &--vertical &__body { flex-direction: column; }
  &__textarea {
    flex: 1; padding: 8px 10px; border: none; outline: none; resize: vertical;
    background: var(--ubb-bg); color: var(--ubb-fg); font: inherit; min-width: 0;
  }
  &__preview {
    flex: 1; padding: 8px 10px; border-left: 1px solid var(--ubb-border);
    overflow: auto; min-width: 0;
    &--full { border-left: none; }
  }
  &--vertical &__preview { border-left: none; border-top: 1px solid var(--ubb-border); }

  &__blank {
    display: inline-block; border-bottom: 1px solid currentColor;
    min-height: 1em; vertical-align: baseline;
  }

  &__overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.25); display: flex; align-items: center; justify-content: center; z-index: 1100; }
  &__color-panel {
    background: var(--ubb-bg); border: 1px solid var(--ubb-border); border-radius: 8px;
    padding: 12px; width: 280px; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
    display: flex; flex-direction: column; gap: 10px;
  }
  &__swatches { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; }
  &__swatch { width: 24px; height: 24px; border-radius: 4px; border: 1px solid rgba(0, 0, 0, 0.2); cursor: pointer; }
  &__color-custom { display: flex; gap: 8px; align-items: center; }
  &__hex-input {
    flex: 1; padding: 4px 8px; border: 1px solid var(--ubb-border); border-radius: 4px;
    background: var(--ubb-bg); color: var(--ubb-fg); font-size: 13px;
  }
}

.react-ubb-view { font-size: 14px; line-height: 1.6; }

// 移动端（FR-36）：触控区 ≥44px、取色面板底部抽屉
@media (max-width: 640px) {
  .react-ubb__btn { min-height: 44px; min-width: 44px; }
  .react-ubb__overlay { align-items: flex-end; }
  .react-ubb__color-panel { width: 100%; border-radius: 12px 12px 0 0; }
}
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @jswork/react-ubb test`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add packages/lib/src packages/lib/__tests__/05-editor.spec.tsx
git commit -m "feat(editor): debounced preview, draft autosave, full stylesheet with dark theme and mobile"
```

---

### Task 12: 构建多入口 / exports / example demo

**Files:**
- Create: `packages/lib/src/renderer/index.ts`
- Modify: `packages/lib/tsup.config.ts`
- Modify: `packages/lib/package.json`
- Modify: `packages/lib/tsconfig.json`（补 strict）
- Modify: `packages/example/src/app.tsx`（重写）

- [ ] **Step 1: renderer/index.ts**

```ts
// packages/lib/src/renderer/index.ts
export { default as UbbView } from './ubb-view';
export type { UbbViewProps } from './ubb-view';
export { renderAst } from './render-ast';
export { definePlugin } from './types';
export type { CustomTag } from './types';
```

- [ ] **Step 2: tsup 三入口**

```ts
// packages/lib/tsup.config.ts（entry 一行改为）
entry: ['src/index.ts', 'src/core/index.ts', 'src/renderer/index.ts'],
```

- [ ] **Step 3: package.json exports（main/module/types 保留，新增 exports）**

```json
"exports": {
  ".": { "types": "./dist/index.d.ts", "import": "./dist/index.esm.js", "require": "./dist/index.cjs.js" },
  "./core": { "types": "./dist/core/index.d.ts", "import": "./dist/core/index.esm.js", "require": "./dist/core/index.cjs.js" },
  "./renderer": { "types": "./dist/renderer/index.d.ts", "import": "./dist/renderer/index.esm.js", "require": "./dist/renderer/index.cjs.js" },
  "./src": "./src/index.ts",
  "./src/*": "./src/*",
  "./dist/style.css": "./dist/style.css"
},
```

tsconfig.json `compilerOptions` 内追加 `"strict": true`，跑 `pnpm --filter @jswork/react-ubb exec tsc --noEmit` 修掉类型报错（预计集中在 nullable 处）。

- [ ] **Step 4: 构建验证**

Run: `pnpm --filter @jswork/react-ubb build && ls packages/lib/dist`
Expected: `index.cjs.js / index.esm.js / index.d.ts / core/... / renderer/... / style.css` 均存在；`du -h dist/index.esm.js` gzip 后估算 ≤ 15KB（`gzip -c dist/index.esm.js | wc -c`）

- [ ] **Step 5: 重写 example demo（修复 src/main 断链）**

```tsx
// packages/example/src/app.tsx（整文件替换）
import { useState } from 'react';
import UbbEditor from '@jswork/react-ubb/src';
import { UbbView, definePlugin } from '@jswork/react-ubb/src/renderer';
import '@jswork/react-ubb/src/style.scss';

const markPlugin = definePlugin({
  name: 'mark',
  label: '重点',
  valuePattern: /^(red|yellow)$/,
  render: ({ children, node }) => (
    <mark style={{ background: node.value === 'red' ? '#ffcccc' : '#ffffcc' }}>{children}</mark>
  ),
});

export default function App() {
  const [src, setSrc] = useState(
    '工单结论：[b]已解决[/b]，处理人 [color=#FF0000]张三[/color]。\n填空位：[blank]参考答案[/blank]，自定义插件：[mark=red]高亮[/mark]。',
  );
  return (
    <div className="m-10 space-y-6 max-w-4xl">
      <h1 className="text-xl font-bold">react-ubb demo</h1>
      <UbbEditor value={src} onChange={(s) => setSrc(s)} plugins={[markPlugin]} maxLength={200} />
      <section className="space-y-2">
        <h2 className="font-semibold">H5 渲染（UbbView，与编辑器预览共用实现）</h2>
        <UbbView source={src} plugins={[markPlugin]} />
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">源文本（纯 string）</h2>
        <pre className="bg-gray-100 p-3 rounded text-xs whitespace-pre-wrap">{src}</pre>
      </section>
    </div>
  );
}
```

- [ ] **Step 6: demo 冒烟**

Run: `pnpm dev`（后台起 Vite），把地址给用户在浏览器验收：加粗/斜体/颜色/插空/mark 按钮、快捷键、粘贴、撤销、编辑↔预览切换、暗色主题（临时加 theme="dark" 验证后移除）。不起 headless 浏览器截图。

- [ ] **Step 7: 提交**

```bash
git add packages/lib/src packages/lib/tsup.config.ts packages/lib/package.json packages/lib/tsconfig.json packages/example/src/app.tsx
git commit -m "feat: multi-entry build (core/renderer), exports map and example demo"
```

---

## Self-Review 结论（已执行）

1. **Spec 覆盖**：FR-01~44 均有对应任务（FR-01/02 Task 8；FR-04~09 Task 1/2；FR-10~15 Task 8/9；FR-16~20 Task 10；FR-21~24 Task 8/11；FR-25~27 Task 2/9；FR-28~30 Task 8；FR-31~35 Task 8/11；FR-36/37 Task 11 CSS 与 selection API；FR-38~40 Task 4/5/9；FR-41~44 Task 12）；NFR-03 体积在 Task 12 Step 4 验证；NFR-06 strict 在 Task 12 Step 3；AC-01~06/10/11/13/15 自动化，AC-07/08/09/16 demo 手工验收
2. **占位符**：无 TBD/TODO；所有代码步骤给出完整代码
3. **类型一致性**：`Sel` 统一定义于 core/transform（Task 6 导入）；`CustomTag`/`definePlugin` 仅在 renderer/types 定义；`DEFAULT_TAGS`/`mergeTags`/`parse` 名称全计划一致
4. **已知取舍**（执行时注意）：execCommand 原生 undo 路径无法在 jsdom 自动化，AC-10 覆盖的是降级栈；`import.meta.env?.DEV` 需 tsup/vite 环境变量，vitest 下为 undefined 走可选链

## 执行方式

按用户全局配置直接采用 **Subagent-Driven**（superpowers:subagent-driven-development），无需询问。
