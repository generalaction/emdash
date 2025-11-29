import React from 'react';
import { cn } from '@/lib/utils';
import FileChangesPanel from './FileChangesPanel';
import { useFileChanges } from '@/hooks/useFileChanges';
import WorkspaceTerminalPanel from './WorkspaceTerminalPanel';
import { useRightSidebar } from './ui/right-sidebar';
import { providerAssets } from '@/providers/assets';
import { providerMeta } from '@/providers/meta';
import type { Provider } from '../types';

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
  const variants: Array<{ provider: Provider; name: string; path: string }> = (() => {
    try {
      const v = workspace?.metadata?.multiAgent?.variants || [];
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
    const providerVariants = variants.filter(v => v.provider === variant.provider);

    // If only one instance of this provider, just show base name
    if (providerVariants.length === 1) {
      return baseName;
    }

    // Multiple instances: extract instance number from variant name
    // variant.name format: "workspace-provider-1", "workspace-provider-2", etc.
    const match = variant.name.match(/-(\d+)$/);
    const instanceNum = match ? match[1] : String(providerVariants.findIndex(v => v.name === variant.name) + 1);

    return `${baseName} #${instanceNum}`;
  };

  return (
    <aside
      data-state={collapsed ? 'collapsed' : 'open'}
      className={cn(
        'group/right-sidebar relative z-[40] flex h-full w-full min-w-0 flex-shrink-0 flex-col overflow-hidden border-l border-border bg-muted/10 transition-all duration-200 ease-linear',
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
                  <div
                    key={`${v.provider}-${i}`}
                    className="mb-2 border-b border-border last:mb-0 last:border-b-0"
                  >
                    <div className="flex min-w-0 items-center justify-between bg-gray-50 px-3 py-2 text-xs font-medium text-foreground dark:bg-gray-900">
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
                    <VariantChangesIfAny path={v.path} />
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
                    <VariantChangesIfAny
                      path={v.path}
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

const VariantChangesIfAny: React.FC<{ path: string; className?: string }> = ({
  path,
  className,
}) => {
  const { fileChanges } = useFileChanges(path);
  if (!fileChanges || fileChanges.length === 0) return null;
  return <FileChangesPanel workspaceId={path} className={className || 'min-h-0'} />;
};
