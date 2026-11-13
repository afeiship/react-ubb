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
  colorPanelTitle: '取色器',
  colorCustom: '自定义颜色',
  colorHex: '十六进制',
  colorRecent: '最近使用',
};
