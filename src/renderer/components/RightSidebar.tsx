import React, { useState } from 'react';
import { cn } from '@renderer/lib/utils';
import {
  RightSidebarViewProvider,
  useRightSidebarView,
} from '../contexts/RightSidebarViewProvider';
import FileChangesPanel from './FileChangesPanel';
import { TaskScopeProvider } from './TaskScopeContext';
import TaskTerminalPanel from './TaskTerminalPanel';
import { useRightSidebar } from './ui/right-sidebar';

export interface RightSidebarTask {
  id: string;
  name: string;
  branch: string;
  path: string;
  status: 'active' | 'idle' | 'running';
  agentId?: string;
  metadata?: any;
}

interface RightSidebarProps extends React.HTMLAttributes<HTMLElement> {
  task: RightSidebarTask | null;
  projectPath?: string | null;
  projectRemoteConnectionId?: string | null;
  projectRemotePath?: string | null;
  projectDefaultBranch?: string | null;
  forceBorder?: boolean;
  onOpenChanges?: (filePath?: string, taskPath?: string) => void;
}

const RightSidebarInner: React.FC<RightSidebarProps> = ({
  task,
  projectPath,
  projectRemoteConnectionId,
  projectRemotePath,
  className,
  forceBorder = false,
  onOpenChanges,
  ...rest
}) => {
  const { collapsed } = useRightSidebar();
  const { activeTab, setActiveTab } = useRightSidebarView();
  const [isDarkMode, setIsDarkMode] = useState(false);

  React.useEffect(() => {
    const checkDarkMode = () => {
      setIsDarkMode(document.documentElement.classList.contains('dark'));
    };
    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const remote = projectRemoteConnectionId
    ? {
        connectionId: projectRemoteConnectionId,
        projectPath: projectRemotePath || projectPath || undefined,
      }
    : undefined;

  return (
    <aside
      data-state={collapsed ? 'collapsed' : 'open'}
      className={cn(
        'group/right-sidebar relative z-[45] flex h-full w-full min-w-0 flex-shrink-0 flex-col overflow-hidden transition-all duration-200 ease-linear',
        forceBorder
          ? 'bg-background'
          : 'border-l border-border bg-muted/10 data-[state=collapsed]:border-l-0',
        'data-[state=collapsed]:pointer-events-none',
        className
      )}
      style={
        forceBorder
          ? {
              borderLeft: collapsed
                ? 'none'
                : isDarkMode
                  ? '2px solid rgb(63, 63, 70)'
                  : '2px solid rgb(228, 228, 231)',
              boxShadow: collapsed
                ? 'none'
                : isDarkMode
                  ? '-2px 0 8px rgba(0,0,0,0.5)'
                  : '-2px 0 8px rgba(0,0,0,0.1)',
            }
          : undefined
      }
      aria-hidden={collapsed}
      {...rest}
    >
      <TaskScopeProvider value={{ taskId: task?.id, taskPath: task?.path, projectPath }}>
        <div className="flex h-full w-full min-w-0 flex-col">
          {/* Tab header */}
          <div className="flex shrink-0 border-b border-border bg-muted dark:bg-background">
            <button
              type="button"
              onClick={() => setActiveTab('git')}
              className={cn(
                'px-4 py-2 text-xs font-medium transition-colors',
                activeTab === 'git'
                  ? 'border-b-2 border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Git
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('terminals')}
              className={cn(
                'px-4 py-2 text-xs font-medium transition-colors',
                activeTab === 'terminals'
                  ? 'border-b-2 border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Terminals
            </button>
          </div>

          {/* Tab content */}
          <div className="min-h-0 flex-1">
            <div className={cn('h-full', activeTab === 'git' ? 'block' : 'hidden')}>
              {task || projectPath ? (
                <FileChangesPanel className="h-full min-h-0" onOpenChanges={onOpenChanges} />
              ) : (
                <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
                  <span>Select a task to review file changes.</span>
                </div>
              )}
            </div>
            <div className={cn('h-full', activeTab === 'terminals' ? 'block' : 'hidden')}>
              <TaskTerminalPanel task={task} className="h-full min-h-0" remote={remote} />
            </div>
          </div>
        </div>
      </TaskScopeProvider>
    </aside>
  );
};

const RightSidebar: React.FC<RightSidebarProps> = (props) => {
  return (
    <RightSidebarViewProvider>
      <RightSidebarInner {...props} />
    </RightSidebarViewProvider>
  );
};

export default RightSidebar;
