import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import FileChangesPanel from './FileChangesPanel';
import TaskTerminalPanel from './TaskTerminalPanel';
import { useRightSidebar } from './ui/right-sidebar';
import { agentAssets } from '@/providers/assets';
import { agentMeta } from '@/providers/meta';
import AgentLogo from './AgentLogo';
import type { Agent } from '../types';
import { TaskScopeProvider, useTaskScope } from './TaskScopeContext';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './ui/resizable';
import { RIGHT_SIDEBAR_VERTICAL_STORAGE_KEY } from '@/constants/layout';

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

const RightSidebar: React.FC<RightSidebarProps> = ({
  task,
  projectPath,
  projectRemoteConnectionId,
  projectRemotePath,
  projectDefaultBranch,
  className,
  forceBorder = false,
  onOpenChanges,
  ...rest
}) => {
  const { collapsed } = useRightSidebar();
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [collapsedVariants, setCollapsedVariants] = useState<Set<string>>(new Set());

  const toggleVariantCollapsed = (variantKey: string) => {
    setCollapsedVariants((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(variantKey)) {
        newSet.delete(variantKey);
      } else {
        newSet.add(variantKey);
      }
      return newSet;
    });
  };

  React.useEffect(() => {
    const checkDarkMode = () => {
      setIsDarkMode(document.documentElement.classList.contains('dark'));
    };
    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Detect multi-agent variants in task metadata
  const variants: Array<{ agent: Agent; name: string; path: string; worktreeId?: string }> =
    (() => {
      try {
        const v = task?.metadata?.multiAgent?.variants || [];
        if (Array.isArray(v))
          return v
            .map((x: any) => ({
              agent: x?.agent as Agent,
              name: x?.name,
              path: x?.path,
              worktreeId: x?.worktreeId,
            }))
            .filter((x) => x?.path);
      } catch {}
      return [];
    })();

  // Helper to generate display label with instance number if needed
  const getVariantDisplayLabel = (variant: { agent: Agent; name: string }): string => {
    const meta = agentMeta[variant.agent];
    const asset = agentAssets[variant.agent];
    const baseName = meta?.label || asset?.name || String(variant.agent);

    // Count how many variants use this agent
    const agentVariants = variants.filter((v) => v.agent === variant.agent);

    // If only one instance of this agent, just show base name
    if (agentVariants.length === 1) {
      return baseName;
    }

    // Multiple instances: extract instance number from variant name
    // variant.name format: "task-agent-1", "task-agent-2", etc.
    const match = variant.name.match(/-(\d+)$/);
    const instanceNum = match
      ? match[1]
      : String(agentVariants.findIndex((v) => v.name === variant.name) + 1);

    return `${baseName} #${instanceNum}`;
  };

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
          {task || projectPath ? (
            <div className="flex h-full flex-col">
              {task && variants.length > 1 ? (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {variants.map((v, i) => {
                    const variantKey = `${v.agent}-${i}`;
                    const isCollapsed = collapsedVariants.has(variantKey);
                    return (
                      <div
                        key={variantKey}
                        className="mb-2 border-b border-border last:mb-0 last:border-b-0"
                      >
                        <button
                          type="button"
                          onClick={() => toggleVariantCollapsed(variantKey)}
                          className="flex w-full min-w-0 cursor-pointer items-center justify-between bg-muted px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/80 dark:bg-background dark:hover:bg-muted/20"
                        >
                          <span className="inline-flex min-w-0 items-center gap-2">
                            {isCollapsed ? (
                              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            )}
                            {(() => {
                              const asset = agentAssets[v.agent as keyof typeof agentAssets];
                              const meta = (agentMeta as any)[v.agent] as
                                | { label?: string }
                                | undefined;
                              return (
                                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 text-[10px] font-medium">
                                  {asset?.logo ? (
                                    <AgentLogo
                                      logo={asset.logo}
                                      alt={asset.alt || meta?.label || String(v.agent)}
                                      isSvg={asset.isSvg}
                                      invertInDark={asset.invertInDark}
                                      className="h-3.5 w-3.5"
                                    />
                                  ) : null}
                                  {getVariantDisplayLabel(v)}
                                </span>
                              );
                            })()}
                            <span className="truncate" title={v.name}>
                              {v.name}
                            </span>
                          </span>
                        </button>
                        {!isCollapsed && (
                          <TaskScopeProvider
                            value={{ taskId: task.id, taskPath: v.path, projectPath }}
                          >
                            <VariantChangesIfAny
                              path={v.path}
                              taskId={task.id}
                              onOpenChanges={onOpenChanges}
                            />
                            <TaskTerminalPanel
                              task={{
                                ...task,
                                path: v.path,
                                name: v.name || task.name,
                              }}
                              agent={v.agent}
                              projectPath={projectPath || task?.path}
                              remote={
                                projectRemoteConnectionId
                                  ? {
                                      connectionId: projectRemoteConnectionId,
                                      projectPath: projectRemotePath || projectPath || undefined,
                                    }
                                  : undefined
                              }
                              defaultBranch={projectDefaultBranch || undefined}
                              portSeed={v.worktreeId}
                              className="min-h-[200px]"
                            />
                          </TaskScopeProvider>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : task && variants.length === 1 ? (
                (() => {
                  const v = variants[0];
                  const derived = {
                    ...task,
                    path: v.path,
                    name: v.name || task.name,
                  } as any;
                  return (
                    <ResizablePanelGroup
                      direction="vertical"
                      autoSaveId={RIGHT_SIDEBAR_VERTICAL_STORAGE_KEY}
                    >
                      <ResizablePanel defaultSize={50} minSize={20}>
                        <VariantChangesIfAny
                          path={v.path}
                          taskId={task.id}
                          className="h-full min-h-0"
                          onOpenChanges={onOpenChanges}
                        />
                      </ResizablePanel>
                      <ResizableHandle />
                      <ResizablePanel defaultSize={50} minSize={20}>
                        <TaskTerminalPanel
                          task={derived}
                          agent={v.agent}
                          projectPath={projectPath || task?.path}
                          remote={
                            projectRemoteConnectionId
                              ? {
                                  connectionId: projectRemoteConnectionId,
                                  projectPath: projectRemotePath || projectPath || undefined,
                                }
                              : undefined
                          }
                          defaultBranch={projectDefaultBranch || undefined}
                          portSeed={v.worktreeId}
                          className="h-full min-h-0"
                        />
                      </ResizablePanel>
                    </ResizablePanelGroup>
                  );
                })()
              ) : task ? (
                <SingleTaskSidebar
                  task={task}
                  projectPath={projectPath}
                  projectRemoteConnectionId={projectRemoteConnectionId}
                  projectRemotePath={projectRemotePath}
                  projectDefaultBranch={projectDefaultBranch}
                  onOpenChanges={onOpenChanges}
                />
              ) : (
                <ResizablePanelGroup
                  direction="vertical"
                  autoSaveId={RIGHT_SIDEBAR_VERTICAL_STORAGE_KEY}
                >
                  <ResizablePanel defaultSize={50} minSize={20}>
                    <div className="flex h-full flex-col bg-background">
                      <div className="border-b border-border bg-muted px-3 py-2 text-sm font-medium text-foreground dark:bg-background">
                        <span className="whitespace-nowrap">Changes</span>
                      </div>
                      <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
                        <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                          Select a task to review file changes.
                        </span>
                      </div>
                    </div>
                  </ResizablePanel>
                  <ResizableHandle />
                  <ResizablePanel defaultSize={50} minSize={20}>
                    <TaskTerminalPanel
                      task={null}
                      agent={undefined}
                      projectPath={projectPath || undefined}
                      remote={
                        projectRemoteConnectionId
                          ? {
                              connectionId: projectRemoteConnectionId,
                              projectPath: projectRemotePath || projectPath || undefined,
                            }
                          : undefined
                      }
                      defaultBranch={projectDefaultBranch || undefined}
                      className="h-full min-h-0"
                    />
                  </ResizablePanel>
                </ResizablePanelGroup>
              )}
            </div>
          ) : (
            <ResizablePanelGroup
              direction="vertical"
              autoSaveId={RIGHT_SIDEBAR_VERTICAL_STORAGE_KEY}
              className="text-sm text-muted-foreground"
            >
              <ResizablePanel defaultSize={50} minSize={20}>
                <div className="flex h-full flex-col bg-background">
                  <div className="border-b border-border bg-muted px-3 py-2 text-sm font-medium text-foreground dark:bg-background">
                    <span className="whitespace-nowrap">Changes</span>
                  </div>
                  <div className="flex flex-1 items-center justify-center px-4 text-center">
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                      Select a task to review file changes.
                    </span>
                  </div>
                </div>
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel defaultSize={50} minSize={20}>
                <div className="flex h-full flex-col bg-background">
                  <div className="border-b border-border bg-muted px-3 py-2 text-sm font-medium text-foreground dark:bg-background">
                    <span className="whitespace-nowrap">Terminal</span>
                  </div>
                  <div className="flex flex-1 items-center justify-center px-4 text-center">
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                      Select a task to open its terminal.
                    </span>
                  </div>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          )}
        </div>
      </TaskScopeProvider>
    </aside>
  );
};

export default RightSidebar;

const SingleTaskSidebar: React.FC<{
  task: RightSidebarTask;
  projectPath?: string | null;
  projectRemoteConnectionId?: string | null;
  projectRemotePath?: string | null;
  projectDefaultBranch?: string | null;
  onOpenChanges?: (filePath?: string, taskPath?: string) => void;
}> = ({
  task,
  projectPath,
  projectRemoteConnectionId,
  projectRemotePath,
  projectDefaultBranch,
  onOpenChanges,
}) => {
  return (
    <>
      <FileChangesPanel
        className="min-h-0 flex-1 border-b border-border"
        onOpenChanges={onOpenChanges}
      />
      <TaskTerminalPanel
        task={task}
        agent={task.agentId as Agent}
        projectPath={projectPath || task?.path}
        remote={
          projectRemoteConnectionId
            ? {
                connectionId: projectRemoteConnectionId,
                projectPath: projectRemotePath || projectPath || undefined,
              }
            : undefined
        }
        defaultBranch={projectDefaultBranch || undefined}
        className="min-h-0 flex-1"
      />
    </>
  );
};

const VariantChangesIfAny: React.FC<{
  path: string;
  taskId: string;
  className?: string;
  onOpenChanges?: (filePath?: string, taskPath?: string) => void;
}> = ({ path, taskId, className, onOpenChanges }) => {
  const { projectPath } = useTaskScope();
  return (
    <TaskScopeProvider value={{ taskId, taskPath: path, projectPath }}>
      <FileChangesPanel className={className || 'min-h-0'} onOpenChanges={onOpenChanges} />
    </TaskScopeProvider>
  );
};
