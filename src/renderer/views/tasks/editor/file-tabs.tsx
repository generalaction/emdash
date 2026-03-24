import { Loader2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { FileIcon } from '@renderer/components/FileExplorer/FileIcons';
import type { ManagedFile } from '@renderer/core/editor/types';
import { buildMonacoModelPath } from '@renderer/core/monaco/monacoModelPath';
import { useIsDirty, useModelStatus } from '@renderer/core/monaco/use-model';
import { useDelayedBoolean } from '@renderer/hooks/use-delay-boolean';
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
    <div className="flex h-8 shrink-0 items-center overflow-x-auto border-b border-border bg-muted/10 overscroll-x-contain">
      {tabs.map(({ tabId, filePath }) => {
        const file = openFiles.get(filePath);
        if (!file) return null;
        return (
          <FileTab
            key={tabId}
            path={filePath}
            kind={file.kind}
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
  kind: ManagedFile['kind'];
  modelRootPath: string;
  isActive: boolean;
  isUnstable: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onClose: (e: React.MouseEvent) => void;
}

const FileTab: React.FC<FileTabProps> = observer(function FileTab({
  path,
  kind,
  modelRootPath,
  isActive,
  isUnstable,
  onClick,
  onDoubleClick,
  onClose,
}) {
  const fileName = path.split('/').pop() || 'Untitled';
  const bufferUri = buildMonacoModelPath(modelRootPath, path);
  const isDirty = useIsDirty(bufferUri);

  const isMonacoFile = kind === 'text' || kind === 'markdown' || kind === 'svg';
  const modelStatus = useModelStatus(bufferUri);
  const showSpinner = useDelayedBoolean(isMonacoFile && modelStatus === 'loading', 200);

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
      <span className="shrink-0 [&>svg]:h-3 [&>svg]:w-3">
        {showSpinner ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <FileIcon filename={fileName} isDirectory={false} />
        )}
      </span>
      <span className={cn('max-w-[200px] truncate text-xs', isUnstable && 'italic')}>
        {fileName}
      </span>
      {isDirty && (
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
});
