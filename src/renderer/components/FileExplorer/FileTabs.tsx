import React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ManagedFile } from '@/hooks/useFileManager';
import { FileIcon } from './FileIcons';

interface FileTabsProps {
  openFiles: Map<string, ManagedFile>;
  activeFilePath: string | null;
  onTabClick: (filePath: string) => void;
  onTabClose: (filePath: string) => void;
}

export const FileTabs: React.FC<FileTabsProps> = ({
  openFiles,
  activeFilePath,
  onTabClick,
  onTabClose,
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
          onClick={() => onTabClick(path)}
          onClose={(e) => {
            e.stopPropagation();
            onTabClose(path);
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
  onClick: () => void;
  onClose: (e: React.MouseEvent) => void;
}

const FileTab: React.FC<FileTabProps> = ({ path, file, isActive, onClick, onClose }) => {
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
