# UBB 编辑器（@jswork/react-ubb）设计文档

- 日期：2026-11-13
- 状态：设计已确认
- 需求来源：`docs/002-ubb-editor-requirements.md`（v0.2）
- 实现位置：`packages/lib`

## 1. 已确认决策

| 决策点 | 结论 |
| --- | --- |
| 插空 `[blank]` 渲染 | 隐藏被包裹原文，渲染为下划线空位；空位宽度按被包裹文字长度估算（CJK 约 1em/字、拉丁约 0.5em/字）；空标签渲染为固定宽度空位 |
| 未闭合标签 | 预览按自动闭合到文末渲染（不吞字）；编辑器高亮提示；`errors` 含 `unclosed`；`validate()` 返回 false，业务侧据此阻止保存 |
| 字面转义 | `[[b]]` 双括号转义：`[[` 与 `]]` 之间按字面文本渲染（`[[b]]` 显示 `[b]`），不作为标签解析 |
| 取色实现 | 零依赖自研：预设色板（默认 16 色可配）+ `input[type=color]` + hex 输入框 + 最近使用（最多 8） |
| 标签扩展机制 | 插件化 `plugins` + `definePlugin`：每个插件即一个标签定义，覆盖解析（值属性规则）、工具栏（图标 / 快捷键 / 顺序）、渲染；多标签聚合 plugin 打包留待后续，API 不受影响 |

## 2. 技术选型

- **组件实现**：函数组件 + hooks（选区恢复、composition、undo、防抖等交互天然适配）；保留 @jswork 表面惯例：`data-component="react-ubb"`、`cx` 合并类名、`displayName`、`__VERSION__`
- **包结构**：单包多入口，tsup 三个 entry：
  - `index`：编辑器全量（默认入口）
  - `react-ubb/core`：`parse` / `toPlainText` / `visibleLength` / AST 与标签类型，零 React 依赖
  - `react-ubb/renderer`：`UbbView` 只读渲染组件
- **构建 / 测试**：沿用现有 tsup（cjs + esm + dts）+ vitest + @testing-library/react；样式沿用 scss → postsass → `dist/style.css`

## 3. 目录结构

命名约定：**文件 / 目录名全部小写 kebab-case**（如 `ubb-editor.tsx`、`color-picker.tsx`）；组件导出名保持 PascalCase（`UbbEditor`、`UbbView`）。

```text
packages/lib/src/
  index.ts            # 默认导出 UbbEditor + 类型
  core/               # 子路径 react-ubb/core，零 React 依赖
    index.ts          #   子路径出口：re-export
    ast.ts            #   UbbNode / ParseResult / ParseError 类型
    tags.ts           #   TagSpec、BUILT_IN_TAGS(b/i/color)、BLANK_TAG 预设、DEFAULT_TAGS
    parser.ts         #   parse(source, tags?)：单遍状态机
    plain.ts          #   toPlainText / visibleLength
    transform.ts      #   wrapTag（内部含幂等解包）/ insertEmptyTag / replaceColor
  renderer/           # 子路径 react-ubb/renderer
    index.ts          #   子路径出口
    types.ts          #   CustomTag（含 render）
    ubb-view.tsx      #   只读渲染组件
    render-ast.tsx    #   AST → ReactNode
  editor/
    ubb-editor.tsx    #   主组件：受控/非受控、mode、快捷键、composition、粘贴、maxLength
    toolbar.tsx       #   加粗/斜体/颜色/插空/清除/清空 + 字数 + 模式切换
    color-picker.tsx  #   零依赖取色面板
    selection.ts      #   textarea 选区读写、execCommand 优先 + setRangeText 降级、undo 栈
  locale/
    zh-cn.ts
    en-us.ts
  style.scss          # .react-ubb 前缀
```

tsup entry：`src/index.ts`、`src/core/index.ts`、`src/renderer/index.ts`。

`packages/example` 一并修复入口引用（现引用不存在的 `src/main`），改造成完整 demo：编辑器 + H5 `UbbView` 对照。

## 4. 核心类型与 API

```ts
// core/ast.ts
export type UbbNode =
  | { type: 'text'; text: string; range: [number, number] }
  | {
      type: string;            // 'b' | 'i' | 'color' | 自定义标签名
      value?: string;          // 标签值属性原始值（[name=value]），仅声明了 valuePattern 的标签
      color?: string;          // 仅 color：校验通过的 hex，非法时 undefined（渲染降级用）
      children: UbbNode[];
      range: [number, number];       // 含标签外壳的源区间
      contentRange: [number, number]; // 不含标签外壳
    };

export interface ParseError {
  kind: 'unclosed' | 'mismatched' | 'invalid-value' | 'unclosed-escape';
  pos: number;
  message: string;
}

export interface ParseResult {
  ast: UbbNode[];
  errors: ParseError[];
  visibleLength: number;   // 可见字数（剔除标签、转义还原后）
  sourceLength: number;
}

// core/tags.ts —— 纯数据，不含 React 类型
export interface TagSpec {
  name: string;             // 小写标签名
  label?: string;           // 工具栏文案 / aria-label
  paired?: boolean;         // 默认 true（v1 全部成对）
  valuePattern?: RegExp;    // 值属性规则（[name=value]）；color 内置 hex 规则
}
export const BUILT_IN_TAGS: TagSpec[];  // b / i / color
export const BLANK_TAG: TagSpec;        // blank 预设
export const DEFAULT_TAGS: TagSpec[];   // b / i / color / blank

// renderer 侧扩展（编辑器与 UbbView 共用）
export interface CustomTag extends TagSpec {
  icon?: ReactNode;                    // 工具栏图标，缺省渲染 label
  shortcut?: string;                   // 如 'mod+k'（mod = Cmd/Ctrl），仅编辑器聚焦时拦截
  toolbar?: boolean;                   // 默认 true；false = 仅参与解析，不显示按钮
  render?: (props: { children: ReactNode; node: UbbNode }) => ReactNode; // node.value 可用
}

// 定义辅助函数：identity + 类型推导，业务侧获得完整字段提示与校验
export const definePlugin: <T extends CustomTag>(plugin: T) => T;

// 注册语义：
// - plugins 与内置标签同名 → 后者被覆盖（dev 环境 console.warn）
// - 工具栏顺序 = 内置按钮 + plugins 声明顺序（toolbar !== false 的）
// - enabledTags / disabledTags 对内置与插件标签一视同仁
// - blank 预设本身即用 definePlugin 定义（机制的第一个用例）

// core/parser.ts
export function parse(source: string, tags: TagSpec[] = DEFAULT_TAGS): ParseResult;

// core/plain.ts
export function toPlainText(source: string, tags?: TagSpec[]): string;
export function visibleLength(source: string, tags?: TagSpec[]): number;

// core/transform.ts —— 纯函数，返回新文本与选区
export interface TransformResult {
  source: string;
  selection: { start: number; end: number };
}
export function wrapTag(source, selection, tagName, tags?): TransformResult | null;
export function insertEmptyTag(source, cursor, tagName, tags?): TransformResult;
export function replaceColor(source, selection, hex, tags?): TransformResult;
```

编辑器 props / ref（对应 FR-31~35、FR-34）：

```ts
export interface UbbEditorProps {
  value?: string; defaultValue?: string;
  onChange?: (source: string, meta: UbbMeta) => void;
  readOnly?: boolean; disabled?: boolean; placeholder?: string;
  maxLength?: number;                // 按可见字数截断，不切标签
  mode?: 'edit' | 'preview';         // 整体模式切换（可受控，不传内部维护）
  onModeChange?: (mode: 'edit' | 'preview') => void;
  showPreview?: boolean;             // 是否显示预览区（false = 仅编辑）
  previewMode?: 'side' | 'vertical'; // 分栏形态
  fullscreen?: boolean;
  plugins?: CustomTag[];             // 插件注册（definePlugin 产物），见 §4 注册语义
  enabledTags?: string[]; disabledTags?: string[];
  colors?: string[];                 // 预设色板，默认 16 色
  stripPaste?: boolean;              // 粘贴时清除全部 UBB 标签
  autoSave?: { key: string } | boolean;  // localStorage 草稿，默认关
  locale?: 'zh-CN' | 'en-US'; labels?: Partial<Labels>;
  theme?: 'light' | 'dark';
  className?: string; style?: CSSProperties;
}

export interface UbbMeta {
  visibleLength: number; sourceLength: number;
  hasInvalidTag: boolean; hasUnclosedTag: boolean;
  selection: { start: number; end: number };
}

export interface UbbEditorRef {
  focus(): void; blur(): void;
  insertTag(name: string): void;
  getSource(): string; getPlainText(): string;
  clear(): void; validate(): boolean;   // errors.length === 0
}
```

## 5. 解析器规格（单遍状态机，不用正则做结构匹配）

扫描优先级（位置 i 处）：

1. `[[` → 进入转义段，找最近的 `]]`；渲染为段内内容的字面文本（`[[b]]` → `[b]`）；找不到 `]]` 则到文末按字面处理并记录 `unclosed-escape`
2. `[/name]` 且 name 在白名单（大小写不敏感）→ close token
3. `[name]` / `[name=value]` 且 name 在白名单 → open token；值属性仅当 TagSpec 声明了 `valuePattern` 才接受
4. 其余 `[`（含白名单外标签、未声明 `valuePattern` 却带值如 `[b=x]`）→ 普通文本字符

栈规则：

- open 入栈；close 匹配栈顶 → 正常闭合
- close 不匹配栈顶 → **就近闭合修复**：弹出到最近的同名标签（被弹出的内层标签视为在该位置闭合），记录 `mismatched`；栈内无同名 → 该 close 按普通文本处理并记录 `mismatched`
- EOF 栈非空 → 全部自动闭合到文末，逐个记录 `unclosed`

值校验（含 color 特例）：`valuePattern` 不匹配或缺失 → 节点保留但 `value: undefined`，记录 `invalid-value`，渲染按无值降级；color 的 pattern 为 `#RGB` / `#RRGGBB`（大小写不敏感），校验通过时同时写入 `color`，不合法时 `color: undefined`、渲染无色（AC-06）。

每个节点带 `range` / `contentRange`，供 transform 判定选区与标签的包含关系。

## 6. transform 规格

- **wrap**：选区完整位于同名标签的 `contentRange` 内 → 改为 unwrap（解包）；否则包裹。选区恢复到新文本中包裹内容上（FR-10/12）
- **insertEmpty**：`[tag][/tag]`，光标置于中间（FR-11）；声明了 `valuePattern` 的标签插入 `[tag=][/tag]`，光标在 `=` 后
- **replaceColor**：选区位于某 color 节点 `contentRange` 内 → 仅替换该标签颜色值，不产生嵌套（FR-18）；否则按 wrap 处理
- 输出统一小写标签（FR-07）

## 7. 编辑器行为

- **插入与 undo**：所有改写选区后走一次 `document.execCommand('insertText', newText)`（一个 undo 单元，满足 AC-10）；返回 false 或不存在时降级 `setRangeText` + 自建 undo 栈（50 步，Ctrl+Z / Ctrl+Shift+Z，仅编辑器聚焦时拦截）
- **快捷键**：Cmd/Ctrl+B、Cmd/Ctrl+I，仅聚焦时拦截（FR-13）
- **输入法**：compositionstart → compositionend 期间冻结标签插入与文本改写（FR-26）
- **粘贴**：`preventDefault`，仅取 `text/plain`；`stripPaste` 时基于 parse 结果剔除全部标签壳（FR-25）
- **maxLength**：每次变更后 parse，超限按可见字数截断：遍历 AST 累计可见字符到上限后重建源文本（标签原样保留成对，超出部分丢弃；重建时文本节点与转义保持原样，无损）
- **预览**：与 `UbbView` 共用 `render-ast`，200ms 防抖；源文本 > 20k 字符关闭实时预览，显示手动刷新按钮（FR-24）
- **未闭合提示**：工具栏下方 / 预览区顶部显示 `hasUnclosedTag` / `hasInvalidTag` 警示条，可定位

## 8. 渲染规格（render-ast，编辑器预览与 UbbView 共用）

| 节点 | 渲染 |
| --- | --- |
| text | 字符串 |
| b | `<strong>` |
| i | `<em>` |
| color（合法） | `<span style={{ color }}>` |
| color（非法） | 直接渲染 children（无色降级） |
| blank | `<span class="react-ubb__blank">`，`minWidth` 按原文可见长度估算（CJK 1em、拉丁 0.5em），空标签 `minWidth: 4em`，内容隐藏（下划线空位样式） |
| 自定义标签 | `CustomTag.render({ children, node })` 优先（`node.value` 可用），未提供时渲染 children || `\n` | `<br />` |

`UbbView` props：`source`、`plugins?`、`className?`；默认标签集 `DEFAULT_TAGS`（含 blank）。

## 9. 样式与 i18n

- 类名 BEM 风格、统一前缀：`.react-ubb`（根）、`__toolbar`、`__btn`（`--pressed`）、`__textarea`、`__preview`、`__counter`、`__blank`、`__color-panel`、`--dark` 主题修饰符
- 深色主题通过根级 `--dark` 修饰符切换 CSS 变量
- 文案全部经 `locale`（zh-CN / en-US），`labels` prop 覆盖

## 10. 测试计划（沿用编号 spec）

| 文件 | 覆盖 |
| --- | --- |
| `01-basic.spec.tsx` | 重写为 UbbEditor 骨架渲染（替代现有占位组件测试） |
| `02-parser.spec.ts` | 白名单、嵌套、交错就近闭合、未闭合、非法颜色、`[[转义]]`、白名单外原样、大小写、可见字数 |
| `03-transform.spec.ts` | wrap 选中 / 光标插入、幂等解包、跨界包裹、replaceColor、选区偏移恢复 |
| `04-renderer.spec.tsx` | UbbView 各节点渲染、blank 空位宽度、非法色降级、转义、`\n`、plugins render、值标签（valuePattern 通过 / 降级） |
| `05-editor.spec.tsx` | AC 中可 jsdom 化的用例：包裹交互、readOnly、快捷键、粘贴、maxLength、meta、validate、plugins 工具栏追加与 shortcut 拦截、同名覆盖 |

AC-07（性能）、AC-08（真机输入法）、AC-09（全键盘）、AC-15/16（视觉 / H5 对照）在 example demo 中手工验收。

## 11. 假设与边界

- 颜色仅接受 3/6 位 hex，`rgb()` v1 不支持（FR-05 可选项）
- 值属性为单值 `[name=value]`，不支持多属性（`[name a=1 b=2]` 按普通文本）
- 白名单标签带意外属性（`[b=x]`）按普通文本处理
- 扩展机制为插件化 `plugins` prop + `definePlugin`；多标签 plugin 打包（聚合 locale / 工具栏分组）留待后续演进，不影响现有 API
- 转义段内不嵌套解析；`[[` 未闭合到文末按字面渲染并报 `unclosed-escape`
- `paired: false` 的单边标签 v1 不实现（TagSpec 预留字段）
- maxLength 截断会以 AST 重建源文本（标签规范化为小写，文本内容无损）
- autoSave 仅 localStorage 简版：`{ key }` 或 `true`（默认 key `react-ubb-draft`）

## 12. 里程碑映射

| 阶段 | 内容 |
| --- | --- |
| M1 | core（parser / plain / transform / ast）+ renderer + 单测 + tsup 多入口 |
| M2 | UbbEditor / Toolbar / selection + undo + 快捷键 + composition + 粘贴 |
| M3 | ColorPicker + 预览联动（防抖 / 降级）+ 计数与校验 |
| M4 | example demo 修复与完善、i18n、暗色主题、移动端样式、无障碍属性 |
