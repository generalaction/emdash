import { useCallback, useEffect, useRef, useState } from 'react';
import { MarkdownPreview } from '@renderer/components/FileExplorer/MarkdownPreview';
import { useDiffDecorations } from '@renderer/core/editor/use-diff-decorations';
import { isMarkdownPath } from '@renderer/core/editor/utils';
import { codeEditorPool } from '@renderer/core/monaco/monaco-code-pool';
import { addMonacoKeyboardShortcuts } from '@renderer/core/monaco/monaco-config';
import { modelRegistry } from '@renderer/core/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/core/monaco/monacoModelPath';
import { PooledCodeEditor } from '@renderer/core/monaco/pooled-code-editor';
import { useEditorContext } from '@renderer/views/tasks/editor/editor-provider';
import { useOpenedFile } from './use-opened-file';

interface TextRendererProps {
  filePath: string;
}

/**
 * Self-contained renderer for `kind: 'text'` files.
 *
 * - Plain text files: always shows the Monaco editor.
 * - Markdown files: toggles between Monaco source and rendered MarkdownPreview.
 *   The toggle state is persisted in `TaskViewStateProvider` via `useOpenedFile`.
 */
export function TextRenderer({ filePath }: TextRendererProps) {
  const { modelRootPath, saveFile, saveAllFiles } = useEditorContext();
  const { openedFile } = useOpenedFile(filePath);

  const editorRef = useRef<any>(null);
  const [editorReady, setEditorReady] = useState(false);

  const bufferUri = editorReady ? buildMonacoModelPath(modelRootPath, filePath) : '';
  useDiffDecorations(editorRef, bufferUri);

  // Stable refs so the Monaco keyboard command (registered once at lease time)
  // always calls the latest version of each function without a stale closure.
  const saveFileRef = useRef(saveFile);
  const saveAllFilesRef = useRef(saveAllFiles);
  useEffect(() => {
    saveFileRef.current = saveFile;
    saveAllFilesRef.current = saveAllFiles;
  });

  // Pre-warm the code editor pool on first mount.
  useEffect(() => {
    codeEditorPool
      .init()
      .catch((err: unknown) => console.warn('[monaco-code-pool] init failed:', err));
  }, []);

  const handleEditorMount = useCallback(
    (editor: any, monaco: any) => {
      editorRef.current = editor;
      addMonacoKeyboardShortcuts(editor, monaco, {
        onSave: () => {
          saveFileRef.current().catch(console.error);
        },
        onSaveAll: () => {
          saveAllFilesRef.current().catch(console.error);
        },
      });
      setEditorReady(true);
    },
    [] // no deps — all functions accessed via always-current refs above
  );

  const isMarkdown = isMarkdownPath(filePath);

  // Markdown defaults to rendered view; plain text has no preview toggle.
  const rendererPreviewMode =
    openedFile?.renderer.kind === 'text' ? openedFile.renderer.previewMode : undefined;
  const isPreviewActive = isMarkdown ? (rendererPreviewMode ?? true) : false;

  if (isPreviewActive && isMarkdown) {
    const content = modelRegistry.getValue(buildMonacoModelPath(modelRootPath, filePath)) ?? '';
    const fileDir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
    return <MarkdownPreview content={content} rootPath={modelRootPath} fileDir={fileDir} />;
  }

  return (
    <PooledCodeEditor
      bufferUri={buildMonacoModelPath(modelRootPath, filePath)}
      glyphMargin={true}
      onMount={handleEditorMount}
    />
  );
}
