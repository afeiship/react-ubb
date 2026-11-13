import { useMemo } from 'react';
import cx from 'classnames';
import { DEFAULT_TAGS, mergeTags, parse } from '../core';
import { renderAst } from './render-ast';
import { CustomTag } from './types';

export interface UbbViewProps {
  source: string;
  /** Prefer a stable reference (module constant / useMemo): a new array identity re-runs parse each render. */
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
