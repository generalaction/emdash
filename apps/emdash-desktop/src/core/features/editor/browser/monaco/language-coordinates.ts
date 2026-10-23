import type { LspLocation, LspQuery } from '@emdash/core/runtimes/lsp/api';
import type * as Monaco from 'monaco-editor';

export function toMonacoRange(range: LspLocation['range']): Monaco.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}

export function toProtocolPosition(position: Monaco.IPosition): LspQuery['position'] {
  return { line: position.lineNumber - 1, character: position.column - 1 };
}
