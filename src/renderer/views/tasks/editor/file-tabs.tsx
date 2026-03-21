import { Eye, Pencil, X } from 'lucide-react';
import React from 'react';
import { FileIcon } from '@renderer/components/FileExplorer/FileIcons';
import type { ManagedFile } from '@renderer/core/editor/types';
import { isMarkdownFile } from '@renderer/core/editor/utils';
import { cn } from '@renderer/lib/utils';

interface FileTabsProps {
  openFiles: Map<string, ManagedFile>;
  activeFilePath: string | null;
  previewFilePath: string | null;
  onTabClick: (filePath: string) => void;
  onTabClose: (filePath: string) => void;
  onPinTab: (filePath: string) => void;
  previewMode: Map<string, boolean>;
  onTogglePreview: (filePath: string) => void;
}

export const FileTabs: React.FC<FileTabsProps> = ({
  openFiles,
  activeFilePath,
  previewFilePath,
  onTabClick,
  onTabClose,
  onPinTab,
  previewMode,
  onTogglePreview,
}) => {
  if (openFiles.size === 0) {
    return null;
  }

  return (
    <div className="flex h-8 shrink-0 items-center overflow-x-auto border-b border-border bg-muted/10 [overscroll-behavior-x:contain]">
      {Array.from(openFiles.entries()).map(([path, file]) => (
        <FileTab
          key={path}
          path={path}
          file={file}
          isActive={activeFilePath === path}
          isUnstable={previewFilePath === path}
          isPreviewable={isMarkdownFile(path) || file.kind === 'svg'}
          isPreview={previewMode.get(path) ?? (isMarkdownFile(path) || file.kind === 'svg')}
          onClick={() => onTabClick(path)}
          onDoubleClick={() => onPinTab(path)}
          onClose={(e) => {
            e.stopPropagation();
            onTabClose(path);
          }}
          onTogglePreview={(e) => {
            e.stopPropagation();
            onTogglePreview(path);
          }}
        />
      ))}
    </div>
  );
};

interface FileTabProps {
  path: string;
  file: ManagedFile;
  isActive: boolean;
  isUnstable: boolean;
  /** Whether this file supports a rendered preview toggle (markdown, SVG). */
  isPreviewable: boolean;
  isPreview: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onClose: (e: React.MouseEvent) => void;
  onTogglePreview: (e: React.MouseEvent) => void;
}

const FileTab: React.FC<FileTabProps> = ({
  path,
  file,
  isActive,
  isUnstable,
  isPreviewable,
  isPreview,
  onClick,
  onDoubleClick,
  onClose,
  onTogglePreview,
}) => {
  const fileName = path.split('/').pop() || 'Untitled';

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
      {file.isDirty && (
        <span className="text-gray-500" title="Unsaved changes">
          ●
        </span>
      )}
      {isPreviewable && (
        <button
          className="ml-0.5 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onTogglePreview}
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
