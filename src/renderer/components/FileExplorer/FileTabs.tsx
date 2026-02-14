import React from 'react';
import { X, Eye, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ManagedFile } from '@/hooks/useFileManager';
import { FileIcon } from './FileIcons';
import { isMarkdownFile } from '@/constants/file-explorer';

interface FileTabsProps {
  openFiles: Map<string, ManagedFile>;
  activeFilePath: string | null;
  onTabClick: (filePath: string) => void;
  onTabClose: (filePath: string) => void;
  previewMode: Map<string, boolean>;
  onTogglePreview: (filePath: string) => void;
}

export const FileTabs: React.FC<FileTabsProps> = ({
  openFiles,
  activeFilePath,
  onTabClick,
  onTabClose,
  previewMode,
  onTogglePreview,
}) => {
  if (openFiles.size === 0) {
    return null;
  }

  return (
    <div className="flex h-8 items-center overflow-x-auto border-b border-border bg-muted/10">
      {Array.from(openFiles.entries()).map(([path, file]) => (
        <FileTab
          key={path}
          path={path}
          file={file}
          isActive={activeFilePath === path}
          isMarkdown={isMarkdownFile(path)}
          isPreview={previewMode.get(path) ?? isMarkdownFile(path)}
          onClick={() => onTabClick(path)}
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
  isMarkdown: boolean;
  isPreview: boolean;
  onClick: () => void;
  onClose: (e: React.MouseEvent) => void;
  onTogglePreview: (e: React.MouseEvent) => void;
}

const FileTab: React.FC<FileTabProps> = ({
  path,
  file,
  isActive,
  isMarkdown,
  isPreview,
  onClick,
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
      title={path}
    >
      <span className="flex-shrink-0 [&>svg]:h-3 [&>svg]:w-3">
        <FileIcon filename={fileName} isDirectory={false} />
      </span>
      <span className="text-xs">{fileName}</span>
      {file.isDirty && (
        <span className="text-gray-500" title="Unsaved changes">
          ●
        </span>
      )}
      {isMarkdown && (
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

export default FileTabs;
