import cx from 'classnames';
import {
  CSSProperties,
  ForwardedRef,
  FormEvent,
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  DEFAULT_TAGS,
  UbbNode,
  isTextNode,
  mergeTags,
  parse,
  toPlainText,
  truncateToVisible,
  Sel,
  TransformResult,
  insertEmptyTag,
  wrapTag,
} from '../core';
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
  style?: CSSProperties;
}

function UbbEditorBase(props: UbbEditorProps, ref: ForwardedRef<UbbEditorRef>) {
  const {
    value,
    defaultValue,
    onChange,
    readOnly,
    disabled,
    placeholder,
    maxLength,
    mode: modeProp,
    onModeChange,
    showPreview = true,
    previewMode = 'side',
    fullscreen,
    plugins,
    enabledTags,
    disabledTags,
    locale = 'zh-CN',
    labels,
    theme = 'light',
    className,
    style,
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

  // Apply a transform through replaceRange: one whole-document replacement =
  // one native undo unit. replaceRange contract: native path fires a real input
  // event (handleInput syncs state); fallback returns false — sync manually.
  const applyTransform = (t: TransformResult | null) => {
    if (!t || readOnly || disabled || mode !== 'edit') return;
    const ta = taRef.current;
    if (!ta) return;
    let next = t;
    if (maxLength != null) {
      const r = parse(t.source, tags);
      if (r.visibleLength > maxLength) {
        const truncated = truncateToVisible(t.source, maxLength, tags);
        const clamp = (v: number) => Math.min(v, truncated.length);
        next = { source: truncated, selection: { start: clamp(t.selection.start), end: clamp(t.selection.end) } };
      }
    }
    const native = replaceRange(ta, next.source, { start: 0, end: source.length }, next.selection);
    if (!native) {
      if (!isControlled) setInnerValue(next.source);
      onChange?.(next.source, computeMeta(next.source, next.selection));
    }
  };

  const handleInput = (e: FormEvent<HTMLTextAreaElement>) => {
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
    const t =
      s.start === s.end
        ? insertEmptyTag(source, s.start, name, undefined, tags)
        : wrapTag(source, s, name, undefined, tags);
    applyTransform(t);
  };

  // which tags' contentRange fully contain the current selection (aria-pressed / clear)
  const activeNames = useMemo(() => {
    const names = new Set<string>();
    const stack: UbbNode[] = [...result.ast].reverse();
    while (stack.length) {
      const node = stack.pop()!;
      if (isTextNode(node)) continue;
      const [cs, ce] = node.contentRange;
      if (cs <= sel.start && sel.end <= ce) {
        names.add(node.type);
        stack.push(...[...node.children].reverse());
      }
    }
    return names;
  }, [result, sel]);

  const handleClear = () => {
    let cur = source;
    let curSel = currentSel();
    for (const name of Array.from(activeNames)) {
      const t = wrapTag(cur, curSel, name, undefined, tags); // inside → unwrap
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
        const t =
          s.start === s.end
            ? insertEmptyTag(source, s.start, name, val, tags)
            : wrapTag(source, s, name, val, tags);
        applyTransform(t);
      },
      // In the fallback path of replaceRange the DOM value updates synchronously
      // while React state does — read the live DOM value so ref accessors are
      // correct even before the re-render lands.
      getSource: () => taRef.current?.value ?? source,
      getPlainText: () => toPlainText(taRef.current?.value ?? source, tags),
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
      className={cx(
        CLASS_NAME,
        {
          [`${CLASS_NAME}--dark`]: theme === 'dark',
          [`${CLASS_NAME}--fullscreen`]: fullscreen,
          [`${CLASS_NAME}--vertical`]: previewMode === 'vertical',
        },
        className,
      )}
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
        onColorClick={() => {}} // wired in Task 10
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
        {mode === 'preview' && (
          <div className={`${CLASS_NAME}__preview ${CLASS_NAME}__preview--full`}>{previewBody}</div>
        )}
        {showPreviewPane && <div className={`${CLASS_NAME}__preview`}>{previewBody}</div>}
      </div>
    </div>
  );
}

const UbbEditor = forwardRef<UbbEditorRef, UbbEditorProps>(UbbEditorBase);
UbbEditor.displayName = CLASS_NAME;
export default UbbEditor;
