import React, { useState } from 'react';
import type { GitPlatform } from '../../shared/git/platform';
import { cn } from '@/lib/utils';
import FileChangesPanel from './FileChangesPanel';
import { FileTree } from './FileExplorer/FileTree';
import { useTaskScope } from './TaskScopeContext';
import { useFileChanges } from '../hooks/useFileChanges';
type SidebarTab = 'changes' | 'files';

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'border-b-2 border-primary text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

interface SidebarTopPanelProps {
  className?: string;
  onOpenChanges?: (filePath?: string, taskPath?: string, commitHash?: string) => void;
  onOpenFile?: (filePath: string) => void;
  gitPlatform?: GitPlatform;
  connectionId?: string | null;
  remotePath?: string | null;
}

const SidebarTopPanel: React.FC<SidebarTopPanelProps> = ({
  className,
  onOpenChanges,
  onOpenFile,
  gitPlatform,
  connectionId,
  remotePath,
}) => {
  const [activeTab, setActiveTab] = useState<SidebarTab>('changes');
  const { taskId, taskPath } = useTaskScope();
  const { fileChanges } = useFileChanges(taskPath ?? '', { isActive: activeTab === 'files' });

  const handleOpenFile = (filePath: string) => {
    onOpenFile?.(filePath);
  };

  return (
    <div className={cn('flex h-full flex-col bg-background', className)}>
      <div className="flex border-b border-border bg-muted dark:bg-background">
        <TabButton active={activeTab === 'changes'} onClick={() => setActiveTab('changes')}>
          Changes
        </TabButton>
        <TabButton active={activeTab === 'files'} onClick={() => setActiveTab('files')}>
          Files
        </TabButton>
      </div>

      {activeTab === 'changes' ? (
        <FileChangesPanel
          className="min-h-0 flex-1"
          onOpenChanges={onOpenChanges}
          gitPlatform={gitPlatform}
        />
      ) : taskId && taskPath ? (
        <FileTree
          taskId={taskId}
          rootPath={taskPath}
          onSelectFile={() => {}}
          onOpenFile={handleOpenFile}
          fileChanges={fileChanges}
          connectionId={connectionId}
          remotePath={remotePath}
          showHiddenFiles
          className="min-h-0 flex-1"
        />
      ) : (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">
            Select a task to browse files.
          </span>
        </div>
      )}
    </div>
  );
};

export default SidebarTopPanel;
