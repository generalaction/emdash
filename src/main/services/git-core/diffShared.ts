import { buildDiffWarnings } from '../../utils/diffParser';
import type { DiffResult } from '../../utils/diffParser';

export type CappedTextResult = {
  exists: boolean;
  tooLarge: boolean;
  content?: string;
  isBinary?: boolean;
};

export function isMaxBufferError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (error as NodeJS.ErrnoException).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
}

export function buildOptionalDiffWarnings(
  originalContent: string | undefined,
  modifiedContent: string | undefined,
  lines: DiffResult['lines']
): DiffResult['warnings'] {
  const warnings = buildDiffWarnings({ originalContent, modifiedContent, lines });
  return warnings.length > 0 ? warnings : undefined;
}

export function buildAddedDiffLines(content: string): DiffResult['lines'] {
  return content.split('\n').map((line) => ({ right: line, type: 'add' as const }));
}

export function buildDeletedDiffLines(content: string): DiffResult['lines'] {
  return content.split('\n').map((line) => ({ left: line, type: 'del' as const }));
}
