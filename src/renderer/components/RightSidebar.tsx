import React from 'react';
import { cn } from '@/lib/utils';
import FileChangesPanel from './FileChangesPanel';
import { useFileChanges } from '@/hooks/useFileChanges';
import TaskTerminalPanel from './TaskTerminalPanel';
import { useRightSidebar } from './ui/right-sidebar';
import { providerAssets } from '@/providers/assets';
import { providerMeta } from '@/providers/meta';
import type { Provider } from '../types';
import { TaskScopeProvider, useTaskScope } from './TaskScopeContext';

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
  forceBorder?: boolean;
}

const RightSidebar: React.FC<RightSidebarProps> = ({
  task,
  projectPath,
  className,
  forceBorder = false,
  ...rest
}) => {
  const { collapsed } = useRightSidebar();
  const [isDarkMode, setIsDarkMode] = React.useState(false);

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
  const variants: Array<{ provider: Provider; name: string; path: string }> = (() => {
    try {
      const v = task?.metadata?.multiAgent?.variants || [];
      if (Array.isArray(v))
        return v
          .map((x: any) => ({ provider: x?.provider as Provider, name: x?.name, path: x?.path }))
          .filter((x) => x?.path);
    } catch {}
    return [];
  })();

  // Helper to generate display label with instance number if needed
  const getVariantDisplayLabel = (variant: { provider: Provider; name: string }): string => {
    const meta = providerMeta[variant.provider];
    const asset = providerAssets[variant.provider];
    const baseName = meta?.label || asset?.name || String(variant.provider);

    // Count how many variants use this provider
    const providerVariants = variants.filter((v) => v.provider === variant.provider);

    // If only one instance of this provider, just show base name
    if (providerVariants.length === 1) {
      return baseName;
    }

    // Multiple instances: extract instance number from variant name
    // variant.name format: "task-provider-1", "task-provider-2", etc.
    const match = variant.name.match(/-(\d+)$/);
    const instanceNum = match
      ? match[1]
      : String(providerVariants.findIndex((v) => v.name === variant.name) + 1);

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
                  {variants.map((v, i) => (
                    <div
                      key={`${v.provider}-${i}`}
                      className="mb-2 border-b border-border last:mb-0 last:border-b-0"
                    >
                      <div className="flex min-w-0 items-center justify-between bg-muted px-3 py-2 text-xs font-medium text-foreground dark:bg-background">
                        <span className="inline-flex min-w-0 items-center gap-2">
                          {(() => {
                            const asset = (providerAssets as any)[v.provider] as
                              | { logo: string; alt: string; name: string; invertInDark?: boolean }
                              | undefined;
                            const meta = (providerMeta as any)[v.provider] as
                              | { label?: string }
                              | undefined;
                            return (
                              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 text-[10px] font-medium">
                                {asset?.logo ? (
                                  <img
                                    src={asset.logo}
                                    alt={asset.alt || meta?.label || String(v.provider)}
                                    className={`h-3.5 w-3.5 object-contain ${asset?.invertInDark ? 'dark:invert' : ''}`}
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
                      </div>
                      <VariantChangesIfAny path={v.path} taskId={task.id} />
                    </div>
                  ))}
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
                    <>
                      <VariantChangesIfAny
                        path={v.path}
                        taskId={task.id}
                        className="min-h-0 flex-1 border-b border-border"
                      />
                      <TaskTerminalPanel
                        task={derived}
                        provider={v.provider}
                        projectPath={projectPath || task?.path}
                        className="min-h-0 flex-1"
                      />
                    </>
                  );
                })()
              ) : task ? (
                <>
                  <FileChangesPanel className="min-h-0 flex-1 border-b border-border" />
                  <TaskTerminalPanel
                    task={task}
                    provider={task.agentId as Provider}
                    projectPath={projectPath || task?.path}
                    className="min-h-0 flex-1"
                  />
                </>
              ) : (
                <>
                  <div className="flex h-1/2 flex-col border-b border-border bg-background">
                    <div className="border-b border-border bg-muted px-3 py-2 text-sm font-medium text-foreground dark:bg-background">
                      <span className="whitespace-nowrap">Changes</span>
                    </div>
                    <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
                      <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                        Select a task to review file changes.
                      </span>
                    </div>
                  </div>
                  <TaskTerminalPanel
                    task={null}
                    provider={undefined}
                    projectPath={projectPath || undefined}
                    className="h-1/2 min-h-0"
                  />
                </>
              )}
            </div>
          ) : (
            <div className="flex h-full flex-col text-sm text-muted-foreground">
              <div className="flex h-1/2 flex-col border-b border-border bg-background">
                <div className="border-b border-border bg-muted px-3 py-2 text-sm font-medium text-foreground dark:bg-background">
                  <span className="whitespace-nowrap">Changes</span>
                </div>
                <div className="flex flex-1 items-center justify-center px-4 text-center">
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                    Select a task to review file changes.
                  </span>
                </div>
              </div>
              <div className="flex h-1/2 flex-col bg-background">
                <div className="border-b border-border bg-muted px-3 py-2 text-sm font-medium text-foreground dark:bg-background">
                  <span className="whitespace-nowrap">Terminal</span>
                </div>
                <div className="flex flex-1 items-center justify-center px-4 text-center">
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                    Select a task to open its terminal.
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </TaskScopeProvider>
    </aside>
  );
};

export default RightSidebar;

const VariantChangesIfAny: React.FC<{ path: string; taskId: string; className?: string }> = ({
  path,
  taskId,
  className,
}) => {
  const { fileChanges } = useFileChanges(path);
  const { projectPath } = useTaskScope();
  if (!fileChanges || fileChanges.length === 0) return null;
  return (
    <TaskScopeProvider value={{ taskId, taskPath: path, projectPath }}>
      <FileChangesPanel className={className || 'min-h-0'} />
    </TaskScopeProvider>
  );
};
