import { Eye, Pencil, X } from 'lucide-react';
import React from 'react';
import { FileIcon } from '@renderer/components/FileExplorer/FileIcons';
import type { ManagedFile } from '@renderer/core/editor/types';
import { useOpenedFile } from '@renderer/core/editor/use-opened-file';
import { isMarkdownFile } from '@renderer/core/editor/utils';
import { buildMonacoModelPath } from '@renderer/core/monaco/monacoModelPath';
import { useIsDirty } from '@renderer/core/monaco/use-model';
import { cn } from '@renderer/lib/utils';

interface FileTabsProps {
  tabs: Array<{ tabId: string; filePath: string }>;
  openFiles: Map<string, ManagedFile>;
  activeFilePath: string | null;
  previewFilePath: string | null;
  modelRootPath: string;
  onTabClick: (filePath: string) => void;
  onTabClose: (filePath: string) => void;
  onPinTab: (filePath: string) => void;
}

export const FileTabs: React.FC<FileTabsProps> = ({
  tabs,
  openFiles,
  activeFilePath,
  previewFilePath,
  modelRootPath,
  onTabClick,
  onTabClose,
  onPinTab,
}) => {
  if (tabs.length === 0) {
    return null;
  }

  return (
    <div className="flex h-8 shrink-0 items-center overflow-x-auto border-b border-border bg-muted/10 [overscroll-behavior-x:contain]">
      {tabs.map(({ tabId, filePath }) => {
        const file = openFiles.get(filePath);
        if (!file) return null;
        return (
          <FileTab
            key={tabId}
            path={filePath}
            modelRootPath={modelRootPath}
            isActive={activeFilePath === filePath}
            isUnstable={previewFilePath === filePath}
            onClick={() => onTabClick(filePath)}
            onDoubleClick={() => onPinTab(filePath)}
            onClose={(e) => {
              e.stopPropagation();
              onTabClose(filePath);
            }}
          />
        );
      })}
    </div>
  );
};

interface FileTabProps {
  path: string;
  modelRootPath: string;
  isActive: boolean;
  isUnstable: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onClose: (e: React.MouseEvent) => void;
}

const FileTab: React.FC<FileTabProps> = ({
  path,
  modelRootPath,
  isActive,
  isUnstable,
  onClick,
  onDoubleClick,
  onClose,
}) => {
  const fileName = path.split('/').pop() || 'Untitled';
  const bufferUri = buildMonacoModelPath(modelRootPath, path);
  const isDirty = useIsDirty(bufferUri);

  const { openedFile, updateRenderer } = useOpenedFile(path);

  const rendererKind = openedFile?.renderer.kind;
  const isPreviewable = rendererKind === 'text' ? isMarkdownFile(path) : rendererKind === 'svg';

  const isPreview = (() => {
    if (!openedFile) return false;
    if (openedFile.renderer.kind === 'text') {
      return openedFile.renderer.previewMode ?? isMarkdownFile(path);
    }
    if (openedFile.renderer.kind === 'svg') {
      return openedFile.renderer.previewMode ?? true;
    }
    return false;
  })();

  const handleTogglePreview = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!openedFile) return;
    if (openedFile.renderer.kind !== 'text' && openedFile.renderer.kind !== 'svg') return;
    updateRenderer((prev) => {
      if (prev.kind !== 'text' && prev.kind !== 'svg') return prev;
      const defaultPreview = prev.kind === 'svg' || isMarkdownFile(path);
      const current = prev.previewMode ?? defaultPreview;
      return { ...prev, previewMode: !current };
    });
  };

  return (
    <div
      className={cn(
        'flex h-full cursor-pointer items-center gap-1.5 border-r border-border px-3 hover:bg-accent/50',
        isActive && 'bg-background'
      )}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title={isUnstable ? `${path} (preview — double-click to keep)` : path}
    >
      <span className="flex-shrink-0 [&>svg]:h-3 [&>svg]:w-3">
        <FileIcon filename={fileName} isDirectory={false} />
      </span>
      <span className={cn('max-w-[200px] truncate text-xs', isUnstable && 'italic')}>
        {fileName}
      </span>
      {isDirty && (
        <span className="text-gray-500" title="Unsaved changes">
          ●
        </span>
      )}
      {isPreviewable && (
        <button
          className="ml-0.5 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={handleTogglePreview}
          aria-label={isPreview ? 'Edit source' : 'Show preview'}
          title={isPreview ? 'Edit source' : 'Show preview'}
        >
          {isPreview ? <Pencil className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        </button>
      )}
      <button
        className="ml-1 rounded p-0.5 hover:bg-accent"
        onClick={onClose}
        aria-label={`Close ${fileName}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
};
