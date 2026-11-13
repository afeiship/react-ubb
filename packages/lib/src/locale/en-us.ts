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
