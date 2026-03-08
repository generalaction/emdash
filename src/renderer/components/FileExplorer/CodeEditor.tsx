import Editor, { loader, type OnChange, type OnMount } from '@monaco-editor/react';
import React, { useEffect } from 'react';
import { DEFAULT_EDITOR_OPTIONS } from '@renderer/constants/file-explorer';
import type { ManagedFile } from '@renderer/hooks/useFileManager';
import { getMonacoLanguageId } from '@renderer/lib/diffUtils';
import { applyMonacoTheme, defineMonacoThemes, getMonacoTheme } from '@renderer/lib/monaco-themes';
import { buildMonacoModelPath } from '@renderer/lib/monacoModelPath';
import { MarkdownPreview } from './MarkdownPreview';
import '@renderer/styles/editor-diff.css';

export interface EditorContentProps {
  activeFile: ManagedFile | null;
  effectiveTheme: string;
  onEditorMount: OnMount;
  onEditorChange: OnChange;
  isPreviewActive: boolean;
  modelRootPath: string;
  taskPath: string;
}

export const EditorContent: React.FC<EditorContentProps> = ({
  activeFile,
  effectiveTheme,
  onEditorMount,
  onEditorChange,
  isPreviewActive,
  modelRootPath,
  taskPath,
}) => {
  useEffect(() => {
    void loader.init().then((monaco) => applyMonacoTheme(monaco, effectiveTheme));
  }, [effectiveTheme]);

  if (!activeFile) {
    return <NoFileOpen />;
  }

  if (activeFile.content.startsWith('data:image/')) {
    return <ImagePreview file={activeFile} />;
  }

  if (activeFile.content === '[IMAGE_ERROR]') {
    return <ImageError file={activeFile} />;
  }

  if (isPreviewActive) {
    const fileDir = activeFile.path.includes('/')
      ? activeFile.path.substring(0, activeFile.path.lastIndexOf('/'))
      : '';
    return <MarkdownPreview content={activeFile.content} rootPath={taskPath} fileDir={fileDir} />;
  }

  return (
    <div className="flex-1">
      <Editor
        height="100%"
        language={getMonacoLanguageId(activeFile.path)}
        path={buildMonacoModelPath(modelRootPath, activeFile.path)}
        keepCurrentModel={true}
        value={activeFile.content}
        onChange={onEditorChange}
        beforeMount={defineMonacoThemes}
        onMount={onEditorMount}
        theme={getMonacoTheme(effectiveTheme)}
        options={DEFAULT_EDITOR_OPTIONS}
      />
    </div>
  );
};

const NoFileOpen: React.FC = () => (
  <div className="flex flex-1 items-center justify-center text-muted-foreground">
    <div className="text-center" />
  </div>
);

const ImagePreview: React.FC<{ file: ManagedFile }> = ({ file }) => (
  <div className="flex flex-1 items-center justify-center overflow-auto bg-background p-8">
    <div className="flex flex-col items-center">
      <div className="relative flex h-[400px] w-[600px] items-center justify-center rounded-lg border border-border bg-muted/20 p-4">
        <img
          src={file.content}
          alt={file.path}
          className="max-h-full max-w-full object-contain"
          style={{ imageRendering: 'auto' }}
        />
      </div>
      <div className="mt-4 text-center">
        <div className="text-sm font-medium text-foreground">{file.path.split('/').pop()}</div>
        <div className="mt-1 text-xs text-muted-foreground">{file.path}</div>
      </div>
    </div>
  </div>
);

const ImageError: React.FC<{ file: ManagedFile }> = ({ file }) => (
  <div className="flex flex-1 items-center justify-center overflow-auto bg-background p-8">
    <div className="text-center text-muted-foreground">
      <p className="mb-2 text-sm">Failed to load image</p>
      <p className="text-xs opacity-70">{file.path}</p>
      <p className="mt-2 text-xs opacity-50">The image file could not be read</p>
    </div>
  </div>
);
