import { useCallback, useEffect, useMemo, useRef } from 'react';
import { addMonacoKeyboardShortcuts } from '@renderer/core/monaco/monaco-config';
import { modelRegistry } from '@renderer/core/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/core/monaco/monacoModelPath';
import { PooledCodeEditor } from '@renderer/core/monaco/pooled-code-editor';
import { useEditorContext } from '@renderer/views/tasks/editor/editor-provider';
import { useOpenedFile } from './use-opened-file';

interface SvgRendererProps {
  filePath: string;
}

/**
 * Self-contained renderer for `kind: 'svg'` files.
 *
 * Defaults to rendered view (SVG image). When the user toggles to source
 * view, switches to the Monaco editor. The toggle state is persisted in
 * `TaskViewStateProvider` via `useOpenedFile`.
 */
export function SvgRenderer({ filePath }: SvgRendererProps) {
  const { modelRootPath, saveFile, saveAllFiles } = useEditorContext();
  const { openedFile } = useOpenedFile(filePath);

  // SVG defaults to rendered view.
  const rendererPreviewMode =
    openedFile?.renderer.kind === 'svg' ? openedFile.renderer.previewMode : undefined;
  const isRendered = rendererPreviewMode ?? true;

  if (isRendered) {
    return <SvgRenderedView filePath={filePath} modelRootPath={modelRootPath} />;
  }

  return (
    <SvgSourceView
      filePath={filePath}
      modelRootPath={modelRootPath}
      saveFile={saveFile}
      saveAllFiles={saveAllFiles}
    />
  );
}

// ---------------------------------------------------------------------------
// Rendered view (SVG as image)
// ---------------------------------------------------------------------------

interface SvgRenderedViewProps {
  filePath: string;
  modelRootPath: string;
}

function SvgRenderedView({ filePath, modelRootPath }: SvgRenderedViewProps) {
  // Read live content from the Monaco buffer model so edits are always reflected.
  const content = modelRegistry.getValue(buildMonacoModelPath(modelRootPath, filePath)) ?? '';

  const svgUrl = useMemo(
    () => (content ? URL.createObjectURL(new Blob([content], { type: 'image/svg+xml' })) : ''),
    [content]
  );

  useEffect(() => {
    return () => {
      if (svgUrl) URL.revokeObjectURL(svgUrl);
    };
  }, [svgUrl]);

  const fileName = filePath.split('/').pop() ?? filePath;

  return (
    <div className="flex h-full items-center justify-center overflow-auto p-4">
      <img src={svgUrl} alt={fileName} className="max-h-full max-w-full object-contain" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Source view (Monaco editor)
// ---------------------------------------------------------------------------

interface SvgSourceViewProps {
  filePath: string;
  modelRootPath: string;
  saveFile: () => Promise<void>;
  saveAllFiles: () => Promise<void>;
}

function SvgSourceView({ filePath, modelRootPath, saveFile, saveAllFiles }: SvgSourceViewProps) {
  const saveFileRef = useRef(saveFile);
  const saveAllFilesRef = useRef(saveAllFiles);
  useEffect(() => {
    saveFileRef.current = saveFile;
    saveAllFilesRef.current = saveAllFiles;
  });

  const handleEditorMount = useCallback((editor: any, monaco: any) => {
    addMonacoKeyboardShortcuts(editor, monaco, {
      onSave: () => {
        saveFileRef.current().catch(console.error);
      },
      onSaveAll: () => {
        saveAllFilesRef.current().catch(console.error);
      },
    });
  }, []);

  return (
    <PooledCodeEditor
      bufferUri={buildMonacoModelPath(modelRootPath, filePath)}
      glyphMargin={true}
      onMount={handleEditorMount}
    />
  );
}
