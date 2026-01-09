import { useEffect, useRef, useCallback } from 'react';
import { useTheme } from '@/hooks/useTheme';

// Constants for timing and delays
const DIFF_CONSTANTS = {
  INITIAL_DELAY_MS: 100,
  REFRESH_INTERVAL_MS: 2000,
  DEBOUNCE_DELAY_MS: 500,
  CACHE_TTL_MS: 5000, // Cache time-to-live: 5 seconds
} as const;

interface DiffLine {
  lineNumber: number;
  type: 'add' | 'modify' | 'delete';
}

interface DiffCacheEntry {
  diff: DiffLine[];
  timestamp: number;
}

interface UseEditorDiffDecorationsOptions {
  editor: any; // Monaco editor instance
  filePath: string;
  taskPath: string;
}

/**
 * Custom hook for managing diff decorations in Monaco editor
 * Shows gutter indicators for added, modified, and deleted lines
 */
export function useEditorDiffDecorations({
  editor,
  filePath,
  taskPath,
}: UseEditorDiffDecorationsOptions) {
  const { effectiveTheme } = useTheme();
  const decorationIdsRef = useRef<string[]>([]);
  const lastDiffRef = useRef<DiffLine[]>([]);
  const diffCacheRef = useRef<Map<string, DiffCacheEntry>>(new Map());

  // Compute diff between original and current content
  const computeDiff = useCallback(async (): Promise<DiffLine[]> => {
    if (!filePath || !taskPath) {
      return [];
    }

    // Ensure the file path is relative to the task path
    let relativePath = filePath;
    if (filePath.startsWith(taskPath)) {
      relativePath = filePath.substring(taskPath.length);
      if (relativePath.startsWith('/')) {
        relativePath = relativePath.substring(1);
      }
    }

    // Check cache first
    const cacheKey = `${taskPath}:${relativePath}`;
    const cached = diffCacheRef.current.get(cacheKey);
    if (cached) {
      const age = Date.now() - cached.timestamp;
      if (age < DIFF_CONSTANTS.CACHE_TTL_MS) {
        // Cache is still valid
        return cached.diff;
      }
    }

    try {
      // Get the diff from git
      const result = await window.electronAPI.getFileDiff({ taskPath, filePath: relativePath });

      if (!result.success || !result.diff || !result.diff.lines) {
        return [];
      }

      const lines = result.diff.lines;

      // If all lines are marked as 'add', it might mean the file is untracked or new
      // In that case, we should not show any decorations
      const allAdded = lines.every((line) => line.type === 'add');
      const allContext = lines.every((line) => line.type === 'context');

      if (allAdded || allContext) {
        // File appears to be untracked or has no changes
        return [];
      }

      const diffLines: DiffLine[] = [];
      let currentLineNumber = 1;
      let pendingDelete = false;

      // Parse the diff to determine which lines are added/modified/deleted
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const nextLine = lines[i + 1];

        if (line.type === 'add') {
          // Check if this add follows a delete (indicates modification)
          if (pendingDelete) {
            // This is a modification
            diffLines.push({ lineNumber: currentLineNumber, type: 'modify' });
            pendingDelete = false;
          } else {
            // This is a pure addition
            diffLines.push({ lineNumber: currentLineNumber, type: 'add' });
          }
          currentLineNumber++;
        } else if (line.type === 'del') {
          // Check if next line is an add (modification pattern)
          if (nextLine && nextLine.type === 'add') {
            // Mark as pending delete - will be handled as modification with the add
            pendingDelete = true;
          } else {
            // Pure deletion (no corresponding add)
            // Note: we don't show decorations for pure deletions in the current file
            pendingDelete = false;
          }
          // Don't increment line number for deletions
        } else if (line.type === 'context') {
          currentLineNumber++;
          pendingDelete = false;
        }
      }

      // Remove duplicates and sort by line number
      const uniqueDiffLines = Array.from(
        new Map(diffLines.map((item) => [`${item.lineNumber}-${item.type}`, item])).values()
      ).sort((a, b) => a.lineNumber - b.lineNumber);

      // Cache the result
      diffCacheRef.current.set(cacheKey, {
        diff: uniqueDiffLines,
        timestamp: Date.now(),
      });

      return uniqueDiffLines;
    } catch (error) {
      console.error('Failed to compute diff:', error);
      return [];
    }
  }, [filePath, taskPath]);

  // Apply decorations to the editor
  const applyDecorations = useCallback(
    (diffLines: DiffLine[]) => {
      if (!editor || !editor.getModel()) {
        return;
      }

      const isDark = effectiveTheme === 'dark';
      const newDecorations: any[] = [];

      for (const diff of diffLines) {
        let className = '';
        let glyphMarginClassName = '';

        if (diff.type === 'add') {
          className = isDark ? 'diff-line-added-dark' : 'diff-line-added-light';
          glyphMarginClassName = 'diff-glyph-added';
        } else if (diff.type === 'modify') {
          className = isDark ? 'diff-line-modified-dark' : 'diff-line-modified-light';
          glyphMarginClassName = 'diff-glyph-modified';
        } else if (diff.type === 'delete') {
          className = isDark ? 'diff-line-deleted-dark' : 'diff-line-deleted-light';
          glyphMarginClassName = 'diff-glyph-deleted';
        }

        newDecorations.push({
          range: {
            startLineNumber: diff.lineNumber,
            startColumn: 1,
            endLineNumber: diff.lineNumber,
            endColumn: 1,
          },
          options: {
            isWholeLine: true,
            className: className,
            glyphMarginClassName: glyphMarginClassName,
            glyphMarginHoverMessage: {
              value:
                diff.type === 'add'
                  ? 'Added line'
                  : diff.type === 'modify'
                    ? 'Modified line'
                    : 'Deleted line',
            },
          },
        });
      }

      // Update decorations
      try {
        decorationIdsRef.current = editor.deltaDecorations(
          decorationIdsRef.current,
          newDecorations
        );
      } catch (error) {
        console.error('Failed to apply decorations:', error);
      }
    },
    [editor, effectiveTheme]
  );

  // Helper function to compare diff arrays efficiently
  const areDiffsEqual = (a: DiffLine[], b: DiffLine[]): boolean => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].lineNumber !== b[i].lineNumber || a[i].type !== b[i].type) {
        return false;
      }
    }
    return true;
  };

  // Update decorations when content changes
  useEffect(() => {
    if (!editor || !filePath) return;

    const updateDecorations = async () => {
      const diffLines = await computeDiff();

      // Only update if diff has changed
      if (!areDiffsEqual(diffLines, lastDiffRef.current)) {
        lastDiffRef.current = diffLines;
        applyDecorations(diffLines);
      }
    };

    // Initial update with a small delay to ensure editor is ready
    const initialTimer = setTimeout(updateDecorations, DIFF_CONSTANTS.INITIAL_DELAY_MS);

    // Set up interval to check for changes periodically
    const interval = setInterval(updateDecorations, DIFF_CONSTANTS.REFRESH_INTERVAL_MS);

    // Listen for model content changes
    let debounceTimer: NodeJS.Timeout | null = null;
    const disposable = editor.onDidChangeModelContent?.(() => {
      // Clear existing debounce timer
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      // Debounce the update
      debounceTimer = setTimeout(updateDecorations, DIFF_CONSTANTS.DEBOUNCE_DELAY_MS);
    });

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
      disposable?.dispose();
      // Clear decorations on cleanup
      if (editor && !editor.isDisposed?.()) {
        try {
          editor.deltaDecorations(decorationIdsRef.current, []);
        } catch (e) {
          // Ignore errors on cleanup
        }
      }
      decorationIdsRef.current = [];
    };
  }, [editor, filePath, computeDiff, applyDecorations]);

  // Clean up decorations when theme changes
  useEffect(() => {
    if (editor && lastDiffRef.current.length > 0) {
      applyDecorations(lastDiffRef.current);
    }
  }, [effectiveTheme, applyDecorations]);

  // Clean up cache periodically to prevent memory leaks
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of diffCacheRef.current.entries()) {
        if (now - entry.timestamp > DIFF_CONSTANTS.CACHE_TTL_MS) {
          diffCacheRef.current.delete(key);
        }
      }
    }, DIFF_CONSTANTS.CACHE_TTL_MS * 2); // Clean up every 10 seconds

    return () => clearInterval(cleanupInterval);
  }, []);

  // Helper to clear decorations immediately
  const clearDecorations = useCallback(() => {
    if (editor && !editor.isDisposed?.()) {
      try {
        decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, []);
      } catch (error) {
        // Ignore errors during cleanup
      }
    }
  }, [editor]);

  return {
    refreshDecorations: async (invalidateCache = false) => {
      // Clear cache if requested (e.g., after save)
      if (invalidateCache && filePath) {
        let relativePath = filePath;
        if (filePath.startsWith(taskPath)) {
          relativePath = filePath.substring(taskPath.length);
          if (relativePath.startsWith('/')) {
            relativePath = relativePath.substring(1);
          }
        }
        const cacheKey = `${taskPath}:${relativePath}`;
        diffCacheRef.current.delete(cacheKey);

        // When invalidating cache on save, clear decorations first
        // This prevents old markers from briefly appearing
        clearDecorations();
      }

      const diffLines = await computeDiff();
      lastDiffRef.current = diffLines;
      applyDecorations(diffLines);
    },
    clearDecorations,
  };
}
