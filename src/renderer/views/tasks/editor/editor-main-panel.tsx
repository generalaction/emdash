import { FileCode } from 'lucide-react';
import { BinaryRenderer } from '@renderer/core/editor/binary-renderer';
import { ImageRenderer } from '@renderer/core/editor/image-renderer';
import { LoadingRenderer } from '@renderer/core/editor/loading-renderer';
import { SvgRenderer } from '@renderer/core/editor/svg-renderer';
import { TextRenderer } from '@renderer/core/editor/text-renderer';
import { TooLargeRenderer } from '@renderer/core/editor/too-large-renderer';
import type { ManagedFile } from '@renderer/core/editor/types';
import { FileTabs } from '@renderer/views/tasks/editor/file-tabs';
import { useEditorContext } from './editor-provider';

export function EditorMainPanel() {
  const {
    modelRootPath,
    openFiles,
    tabs,
    activeFilePath,
    activeFile,
    previewFilePath,
    handleCloseFile,
    setActiveFile,
    pinFile,
  } = useEditorContext();

  if (openFiles.size === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <FileCode className="h-10 w-10 opacity-20" />
        <div className="text-center">
          <p className="text-sm font-medium opacity-50">No file open</p>
          <p className="mt-1 text-xs opacity-35">Select a file from the tree to open it here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <FileTabs
        tabs={tabs}
        openFiles={openFiles}
        activeFilePath={activeFilePath}
        previewFilePath={previewFilePath}
        modelRootPath={modelRootPath}
        onTabClick={setActiveFile}
        onTabClose={handleCloseFile}
        onPinTab={pinFile}
      />
      <ActiveFileRenderer file={activeFile} />
    </div>
  );
}

interface ActiveFileRendererProps {
  file: ManagedFile | null;
}

function ActiveFileRenderer({ file }: ActiveFileRendererProps) {
  if (!file) return null;

  if (file.isLoading) {
    return <LoadingRenderer />;
  }

  switch (file.kind) {
    case 'text':
      return <TextRenderer filePath={file.path} />;
    case 'svg':
      return <SvgRenderer filePath={file.path} />;
    case 'image':
      return <ImageRenderer file={file} />;
    case 'too-large':
      return <TooLargeRenderer file={file} />;
    case 'binary':
      return <BinaryRenderer file={file} />;
    default:
      return null;
  }
}
