export type DiffLineType = 'context' | 'add' | 'del';

export type DiffLineEnding = 'none' | 'lf' | 'crlf' | 'cr' | 'mixed';

export type DiffWarning =
  | { kind: 'hidden-bidi' }
  | { kind: 'line-endings-change'; from: DiffLineEnding; to: DiffLineEnding };

export type DiffMode = 'text' | 'binary' | 'largeText' | 'unrenderable';

export interface DiffLine {
  left?: string;
  right?: string;
  type: DiffLineType;
}

export interface DiffPayload {
  lines: DiffLine[];
  mode: DiffMode;
  warnings?: DiffWarning[];
  isBinary?: boolean;
  originalContent?: string;
  modifiedContent?: string;
}
