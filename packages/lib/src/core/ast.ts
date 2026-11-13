export type UbbNode =
  | { type: 'text'; text: string; range: [number, number] }
  | {
      type: string; // 'b' | 'i' | 'color' | plugin tag names
      value?: string; // raw [name=value] value, only for tags declaring valuePattern
      color?: string; // only for color: validated hex, undefined when invalid
      children: UbbNode[];
      range: [number, number]; // source span including tag shell
      contentRange: [number, number]; // source span excluding tag shell
    };

export type ParseErrorKind = 'unclosed' | 'mismatched' | 'invalid-value' | 'unclosed-escape';

export interface ParseError {
  kind: ParseErrorKind;
  pos: number; // offset into source text
  message: string;
}

export interface ParseResult {
  ast: UbbNode[];
  errors: ParseError[];
  visibleLength: number;
  sourceLength: number;
}
