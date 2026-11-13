import cx from 'classnames';
import { ButtonHTMLAttributes } from 'react';
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

const BUILTIN_KEY: Record<string, Exclude<keyof Labels, 'counter' | 'placeholder'>> = {
  b: 'bold',
  i: 'italic',
  color: 'color',
  blank: 'blank',
};

export default function Toolbar(p: ToolbarProps) {
  const pluginMap = new Map(p.plugins.map((x) => [x.name, x]));
  const off = !!(p.readOnly || p.disabled);
  const btn = (
    name: string,
    label: string,
    pressed: boolean,
    onClick: () => void,
    extra?: Partial<ButtonHTMLAttributes<HTMLButtonElement>>,
  ) => (
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
              (BUILTIN_KEY[tag.name] && p.labels[BUILTIN_KEY[tag.name]]) ||
                pluginMap.get(tag.name)?.label ||
                tag.label ||
                tag.name,
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
          {[p.warnUnclosed && p.labels.warnUnclosed, p.warnInvalid && p.labels.warnInvalid]
            .filter(Boolean)
            .join('；')}
        </div>
      )}
    </div>
  );
}
