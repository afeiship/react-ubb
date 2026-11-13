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
