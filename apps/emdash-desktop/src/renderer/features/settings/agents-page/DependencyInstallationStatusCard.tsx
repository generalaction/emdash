import { Check, Loader2, MoreHorizontal, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { toast } from 'sonner';
import type { HostDependencyInstallation } from '@renderer/lib/stores/use-agent-installation-statuses';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import type {
  AgentPayload,
  InstallOption,
  SelectedSource,
} from '@shared/core/agents/agent-payload';
import { sourceKey } from '@shared/core/agents/agent-payload';
import { InstalledBadge, RecommendedBadge, UsedBadge } from './agent-status-badge';
import { buildSourceRows } from './installation-sources';

export type InstallationState = 'found' | 'not-found' | 'uninstalled' | 'checking';

export type DependencyInstallationStatusCardProps = {
  vm: HostDependencyInstallation;
  /** Full agent payload; used to detect when automatic updates are unavailable. */
  agentPayload?: AgentPayload;
  /** Platform-specific install options from the agent. */
  installOptions: InstallOption[];
  /** The currently selected source (renderer-local intent). */
  selectedSource: SelectedSource;
  /** The derived state to render. */
  state: InstallationState;
  /** Called when the user picks a different source from the menu. */
  onSelectSource: (ref: SelectedSource) => void;
};

export const DependencyInstallationStatusCard = observer(function DependencyInstallationStatusCard({
  vm,
  agentPayload,
  installOptions,
  selectedSource,
  state,
  onSelectSource,
}: DependencyInstallationStatusCardProps) {
  const { used, installations, refresh, fetchLatestVersion, uninstall, isUninstalling } = vm;

  const selectedInstall = installations.find((i) => i.id === sourceKey(selectedSource));
  const versionText =
    state === 'found' && selectedInstall?.version ? `v${selectedInstall.version}` : null;

  // Show the "no automatic updates" hint when auto is selected but method cannot be inferred.
  const updates = agentPayload?.capabilities.hostDependency.updates;
  const strategyKind = updates?.kind === 'supported' ? updates.update.kind : 'none';
  const showNoAutoUpdateHint =
    state === 'found' &&
    selectedSource.kind === 'auto' &&
    selectedInstall?.inferredMethod === null &&
    strategyKind === 'package-manager';

  const uninstallDescriptor = agentPayload?.capabilities.hostDependency.uninstall;
  const canUninstall =
    !!uninstallDescriptor && uninstallDescriptor.kind !== 'none' && state === 'found';

  const sourceRows = buildSourceRows(installOptions, installations);
  const selectedRow = sourceRows.find((r) => sourceKey(r.ref) === sourceKey(selectedSource));
  const selectedLabel = selectedRow?.label ?? selectedSource.kind;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 rounded-lg border p-3">
        {state === 'found' && (
          <div className="flex size-6 items-center justify-center rounded-lg bg-background-success">
            <Check
              className="size-3.5 shrink-0 text-foreground-success"
              absoluteStrokeWidth
              strokeWidth={3}
            />
          </div>
        )}
        {state === 'checking' && (
          <div className="flex size-6 items-center justify-center rounded-lg bg-background-2">
            <Loader2 className="size-3.5 animate-spin text-foreground-muted" />
          </div>
        )}
        {(state === 'not-found' || state === 'uninstalled') && (
          <div className="flex size-6 items-center justify-center rounded-lg bg-background-2">
            <X className="size-3.5 shrink-0 text-foreground-passive" strokeWidth={2.5} />
          </div>
        )}

        <div className="min-w-0 flex-1 truncate text-sm">
          {state === 'found' && (
            <>
              <span>Found</span>
              {versionText && (
                <span className="ml-1 rounded-md bg-background-quaternary-2 px-1 py-0.5 font-mono text-xs text-foreground-muted">
                  {versionText}
                </span>
              )}
              <span className="ml-1">installed using {selectedLabel}</span>
            </>
          )}
          {state === 'checking' && <span className="text-foreground-muted">Checking…</span>}
          {state === 'not-found' && (
            <span className="text-foreground-muted">Not found — install below</span>
          )}
          {state === 'uninstalled' && <span className="text-foreground-muted">Uninstalled</span>}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            className="shrink-0 rounded p-1 text-foreground-passive hover:bg-background-2 hover:text-foreground"
            aria-label="Installation options"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Change source</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Select source</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {sourceRows.map((row) => {
                    const rowKey = sourceKey(row.ref);
                    const isCurrentSource = rowKey === sourceKey(selectedSource);
                    const isCurrentUsed = !!used && rowKey === sourceKey(used);
                    return (
                      <DropdownMenuItem key={rowKey} onClick={() => onSelectSource(row.ref)}>
                        <span className="flex items-center gap-1.5 truncate">
                          <span className="truncate">{row.label}</span>
                          {row.recommended && <RecommendedBadge />}
                          {row.status === 'available' && !isCurrentUsed && <InstalledBadge />}
                          {isCurrentUsed && <UsedBadge />}
                          {isCurrentSource && !isCurrentUsed && (
                            <span className="ml-auto text-xs text-foreground-passive">
                              selected
                            </span>
                          )}
                        </span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                void toast.promise(refresh(), {
                  loading: 'Refreshing installations...',
                  success: 'Installations refreshed',
                  error: 'Failed to refresh installations',
                });
              }}
            >
              Refresh
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                void toast.promise(fetchLatestVersion(), {
                  loading: 'Checking for updates...',
                  success: 'Checked for updates',
                  error: 'Failed to check for updates',
                });
              }}
            >
              Check for updates
            </DropdownMenuItem>
            {canUninstall && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={isUninstalling}
                  onClick={() => {
                    const name = agentPayload?.name ?? 'Agent';
                    void toast.promise(
                      uninstall(used?.kind === 'method' ? used.method : undefined),
                      {
                        loading: `Uninstalling ${name}...`,
                        success: `${name} successfully uninstalled`,
                        error: `Failed to uninstall ${name}`,
                      }
                    );
                  }}
                >
                  Uninstall
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {showNoAutoUpdateHint && (
        <p className="px-1 text-xs text-foreground-muted">
          Automatic updates are not available for this installation.
        </p>
      )}
    </div>
  );
});
