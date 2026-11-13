export interface TagSpec {
  name: string; // lowercase tag name
  label?: string; // toolbar text / aria-label fallback
  paired?: boolean; // reserved, always true in v1
  selfClosing?: boolean; // supports [name/] form, equivalent to [name][/name] with empty node
  valuePattern?: RegExp; // value attribute rule; built-in color uses hex rule
}

export const COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export const BUILT_IN_TAGS: TagSpec[] = [
  { name: 'b', label: 'Bold' },
  { name: 'i', label: 'Italic' },
  { name: 'color', label: 'Color', valuePattern: COLOR_PATTERN },
];

export const BLANK_TAG: TagSpec = { name: 'blank', label: 'Blank' };

export const DEFAULT_TAGS: TagSpec[] = [...BUILT_IN_TAGS, BLANK_TAG];

// extra overrides base same-name entries (keeping base position), others appended
export function mergeTags(base: TagSpec[], extra: TagSpec[] = []): TagSpec[] {
  const out = [...base];
  for (const tag of extra) {
    const idx = out.findIndex((t) => t.name === tag.name);
    if (idx >= 0) {
      if ((import.meta as any).env?.DEV) {
        console.warn(`[react-ubb] tag "${tag.name}" is overridden by plugin config`);
      }
      out[idx] = tag;
    } else {
      out.push(tag);
    }
  }
  return out;
}
