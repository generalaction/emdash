import type * as monacoNS from 'monaco-editor';
import { useEffect, useRef, type RefObject } from 'react';
import { modelRegistry } from '@renderer/core/monaco/monaco-model-registry';
import { computeLineDiff } from './utils';

/**
 * Applies inline gutter decorations (added / modified / deleted line markers) to
 * the Monaco code editor for the currently open file.
 *
 * Rather than polling `rpc.git.getFileDiff`, this hook compares the two Monaco
 * `ITextModel` instances that `MonacoModelRegistry` already manages:
 *   - `file://`  (buffer) — the user's current edits
 *   - `git://HEAD` — the last-committed baseline, kept fresh by the FS watcher
 *                    managed by EditorProvider
 *
 * Decorations are recomputed reactively via `onDidChangeModelContent` on both
 * models — no polling, no TTL cache, no RPC call.
 *
 * @param editorRef - ref to the Monaco IStandaloneCodeEditor instance
 * @param bufferUri - `file://` URI of the buffer model for the active file
 */
export function useDiffDecorations(
  editorRef: RefObject<monacoNS.editor.IStandaloneCodeEditor | null>,
  bufferUri: string
): void {
  const gitUri = bufferUri ? modelRegistry.toGitUri(bufferUri, 'HEAD') : '';

  const decorationIdsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!bufferUri) return;
    let lastEditor: monacoNS.editor.IStandaloneCodeEditor | null = null;

    const applyDecorations = () => {
      const editor = editorRef.current;
      if (!editor) return;
      lastEditor = editor;

      const bufModel = modelRegistry.getModelByUri(bufferUri);
      const gitModel = modelRegistry.getModelByUri(gitUri);

      // Clear decorations if either model is not yet loaded.
      if (!bufModel || !gitModel) {
        if (decorationIdsRef.current.length > 0) {
          try {
            decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, []);
          } catch {
            // ignore — editor may be mid-swap
          }
        }
        return;
      }

      const diffLines = computeLineDiff(gitModel.getValue(), bufModel.getValue());

      const newDecorations = diffLines.map((diff) => {
        const className =
          diff.type === 'add'
            ? 'diff-line-added'
            : diff.type === 'modify'
              ? 'diff-line-modified'
              : 'diff-line-deleted';
        const glyphMarginClassName =
          diff.type === 'add'
            ? 'diff-glyph-added'
            : diff.type === 'modify'
              ? 'diff-glyph-modified'
              : 'diff-glyph-deleted';
        return {
          range: {
            startLineNumber: diff.lineNumber,
            startColumn: 1,
            endLineNumber: diff.lineNumber,
            endColumn: 1,
          },
          options: { isWholeLine: true, className, glyphMarginClassName },
        };
      });

      try {
        decorationIdsRef.current = editor.deltaDecorations(
          decorationIdsRef.current,
          newDecorations
        );
      } catch {
        // ignore — editor may be mid-swap
      }
    };

    const bufModel = modelRegistry.getModelByUri(bufferUri);
    const gitModel = modelRegistry.getModelByUri(gitUri);

    // Apply immediately for the current file, then subscribe to future changes.
    applyDecorations();

    const d1 = bufModel?.onDidChangeContent(applyDecorations);
    const d2 = gitModel?.onDidChangeContent(applyDecorations);

    return () => {
      d1?.dispose();
      d2?.dispose();
      // Clear decorations from the editor when the file changes or unmounts.
      const editor = lastEditor;
      if (editor && decorationIdsRef.current.length > 0) {
        try {
          decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, []);
        } catch {
          // ignore
        }
      }
      decorationIdsRef.current = [];
    };
  }, [bufferUri, gitUri, editorRef]);
}
