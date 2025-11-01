import React from 'react';
import { cn } from '@/lib/utils';
import FileChangesPanel from './FileChangesPanel';
import WorkspaceTerminalPanel from './WorkspaceTerminalPanel';
import { useRightSidebar } from './ui/right-sidebar';

export interface RightSidebarWorkspace {
  id: string;
  name: string;
  branch: string;
  path: string;
  status: 'active' | 'idle' | 'running';
  agentId?: string;
  metadata?: any;
}

interface RightSidebarProps extends React.HTMLAttributes<HTMLElement> {
  workspace: RightSidebarWorkspace | null;
}

const RightSidebar: React.FC<RightSidebarProps> = ({ workspace, className, ...rest }) => {
  const { collapsed } = useRightSidebar();

  // Detect multi-agent variants in workspace metadata
  const variants: Array<{ provider: string; name: string; path: string }> = (() => {
    try {
      const v = workspace?.metadata?.multiAgent?.variants || [];
      if (Array.isArray(v))
        return v.map((x: any) => ({ provider: x?.provider, name: x?.name, path: x?.path })).filter((x) => x?.path);
    } catch {}
    return [];
  })();

  return (
    <aside
      data-state={collapsed ? 'collapsed' : 'open'}
      className={cn(
        'group/right-sidebar relative z-[60] flex h-full w-full min-w-0 flex-shrink-0 flex-col overflow-hidden border-l border-border bg-muted/10 transition-all duration-200 ease-linear',
        'data-[state=collapsed]:pointer-events-none data-[state=collapsed]:border-l-0',
        className
      )}
      aria-hidden={collapsed}
      {...rest}
    >
      <div className="flex h-full w-full min-w-0 flex-col">
        {workspace ? (
          <div className="flex h-full flex-col">
            {variants.length > 1 ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                {variants.map((v, i) => (
                  <div key={`${v.provider}-${i}`} className="mb-2 border-b border-border last:mb-0 last:border-b-0">
                    <div className="flex items-center justify-between bg-gray-50 px-3 py-2 text-xs font-medium text-foreground dark:bg-gray-900">
                      <span className="inline-flex items-center gap-2">
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {v.provider}
                        </span>
                        <span className="truncate" title={v.name}>
                          {v.name}
                        </span>
                      </span>
                    </div>
                    <FileChangesPanel workspaceId={v.path} className="min-h-0" />
                  </div>
                ))}
              </div>
            ) : variants.length === 1 ? (
              (() => {
                const v = variants[0];
                const derived = {
                  ...workspace,
                  path: v.path,
                  name: v.name || workspace.name,
                } as any;
                return (
                  <>
                    <FileChangesPanel
                      workspaceId={v.path}
                      className="min-h-0 flex-1 border-b border-border"
                    />
                    <WorkspaceTerminalPanel workspace={derived} className="min-h-0 flex-1" />
                  </>
                );
              })()
            ) : (
              <>
                <FileChangesPanel
                  workspaceId={workspace.path}
                  className="min-h-0 flex-1 border-b border-border"
                />
                <WorkspaceTerminalPanel workspace={workspace} className="min-h-0 flex-1" />
              </>
            )}
          </div>
        ) : (
          <div className="flex h-full flex-col text-sm text-muted-foreground">
            <div className="flex flex-1 flex-col border-b border-border bg-background">
              <div className="border-b border-border bg-gray-50 px-3 py-2 text-sm font-medium text-foreground dark:bg-gray-900">
                <span className="whitespace-nowrap">Changes</span>
              </div>
              <div className="flex flex-1 items-center justify-center px-4 text-center">
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                  Select a workspace to review file changes.
                </span>
              </div>
            </div>
            <div className="flex flex-1 flex-col border-t border-border bg-background">
              <div className="border-b border-border bg-gray-50 px-3 py-2 text-sm font-medium text-foreground dark:bg-gray-900">
                <span className="whitespace-nowrap">Terminal</span>
              </div>
              <div className="flex flex-1 items-center justify-center px-4 text-center">
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                  Select a workspace to open its terminal.
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};

export default RightSidebar;
