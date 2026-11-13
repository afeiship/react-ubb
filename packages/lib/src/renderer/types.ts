import { ReactNode } from 'react';
import { TagSpec, UbbNode } from '../core';

// the tag member of the UbbNode union (anything but a text node)
export type TagNode = Extract<UbbNode, { children: UbbNode[] }>;

export interface CustomTag extends TagSpec {
  icon?: ReactNode; // toolbar icon; falls back to label
  shortcut?: string; // e.g. 'mod+k' (mod = Cmd/Ctrl)
  toolbar?: boolean; // default true; false = parse-only, no button
  // render is only invoked for tag nodes, never text nodes
  render?: (props: { children: ReactNode; node: TagNode }) => ReactNode;
}

// identity helper: gives full field hints + type checking at the definition site
export const definePlugin = <T extends CustomTag>(plugin: T): T => plugin;
