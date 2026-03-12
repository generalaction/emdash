import type { DiffResult } from '../../utils/diffParser';
import {
  buildAddedDiffLines,
  buildDeletedDiffLines,
  buildOptionalDiffWarnings,
  type CappedTextResult,
} from './diffShared';

type WorkingTreeDiffResolutionInput = {
  diffStdout?: string;
  diffLines: DiffResult['lines'];
  hasHunk: boolean;
  diffTooLarge: boolean;
  diffFailed: boolean;
  original: CappedTextResult;
  modified: CappedTextResult;
};

export function resolveWorkingTreeDiffResult({
  diffStdout,
  diffLines,
  hasHunk,
  diffTooLarge,
  diffFailed,
  original,
  modified,
}: WorkingTreeDiffResolutionInput): DiffResult {
  if (original.isBinary || modified.isBinary) {
    return { lines: [], mode: 'binary', isBinary: true };
  }

  const originalContent = original.content;
  const modifiedContent = modified.content;

  if (diffStdout !== undefined) {
    const warnings = buildOptionalDiffWarnings(originalContent, modifiedContent, diffLines);
    const hasLargeContent = original.tooLarge || modified.tooLarge;

    if (diffTooLarge || hasLargeContent) {
      return {
        lines: diffLines,
        mode: 'largeText',
        originalContent,
        modifiedContent,
        warnings,
      };
    }

    if (diffLines.length === 0) {
      if (modifiedContent !== undefined && !original.exists) {
        const renderedLines = buildAddedDiffLines(modifiedContent);
        return {
          lines: renderedLines,
          mode: 'text',
          modifiedContent,
          warnings: buildOptionalDiffWarnings(originalContent, modifiedContent, renderedLines),
        };
      }
      if (originalContent !== undefined && !modified.exists) {
        const renderedLines = buildDeletedDiffLines(originalContent);
        return {
          lines: renderedLines,
          mode: 'text',
          originalContent,
          warnings: buildOptionalDiffWarnings(originalContent, modifiedContent, renderedLines),
        };
      }
      if (
        !hasHunk &&
        diffStdout.trim() &&
        originalContent === undefined &&
        modifiedContent === undefined
      ) {
        return {
          lines: [],
          mode: 'unrenderable',
        };
      }

      return {
        lines: [],
        mode: 'text',
        originalContent,
        modifiedContent,
        warnings,
      };
    }

    return {
      lines: diffLines,
      mode: 'text',
      originalContent,
      modifiedContent,
      warnings,
    };
  }

  if (diffTooLarge || original.tooLarge || modified.tooLarge) {
    return {
      lines: [],
      mode: 'largeText',
      originalContent,
      modifiedContent,
      warnings: buildOptionalDiffWarnings(originalContent, modifiedContent, []),
    };
  }

  if (modifiedContent !== undefined) {
    const lines = buildAddedDiffLines(modifiedContent);
    return {
      lines,
      mode: 'text',
      originalContent,
      modifiedContent,
      warnings: buildOptionalDiffWarnings(originalContent, modifiedContent, lines),
    };
  }
  if (originalContent !== undefined) {
    const lines = buildDeletedDiffLines(originalContent);
    return {
      lines,
      mode: 'text',
      originalContent,
      modifiedContent,
      warnings: buildOptionalDiffWarnings(originalContent, modifiedContent, lines),
    };
  }
  const fallbackMode: DiffResult['mode'] = diffFailed ? 'unrenderable' : 'text';
  return { lines: [], mode: fallbackMode };
}
