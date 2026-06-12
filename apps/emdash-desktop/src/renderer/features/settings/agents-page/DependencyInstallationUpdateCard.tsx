import { ArrowRight, Loader2, RefreshCw } from 'lucide-react';
import { useMemo } from 'react';
import { useAgentInstallationStatus } from '@renderer/lib/stores/use-agent-installation-statuses';
import type { AgentPayload } from '@shared/core/agents/agent-payload';
import { CommandActionButton, CommandRow } from './install-command-row';

export type DependencyInstallationUpdateCardProps = {
  agentId: string;
  /** SSH connection id; when provided, the update operates on the remote host. */
  connectionId?: string;
  /** Full agent payload used to hydrate the hook and derive per-method update commands. */
  agentPayload: AgentPayload | undefined;
};

/**
 * Self-contained update card for a single agent dependency. Reads the
 * host-scoped installation state via useAgentInstallationStatus and renders
 * the update command for the currently used installation when an update is
 * available. Renders nothing when no update is applicable.
 */
export function DependencyInstallationUpdateCard({
  agentId,
  connectionId,
  agentPayload,
}: DependencyInstallationUpdateCardProps) {
  const vm = useAgentInstallationStatus(agentId, connectionId, agentPayload);
  const { used, update, isUpdating, updatingMethod } = vm;

  const updateCommands = useMemo(() => {
    const map: Record<string, string> = {};
    for (const opt of agentPayload?.installOptions ?? []) {
      if (opt.updateCommand) {
        map[opt.method] = opt.updateCommand;
      }
    }
    return map;
  }, [agentPayload]);

  if (!used?.updateAvailable) return null;

  const usedMethod = used.source.kind === 'method' ? used.source.method : null;
  const updateCommand = usedMethod ? (updateCommands[usedMethod] ?? null) : null;

  if (!updateCommand) return null;

  const isUpdatingThis =
    isUpdating && (updatingMethod === undefined || updatingMethod === usedMethod);

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded-lg bg-background-warning">
            <RefreshCw
              className="size-3.5 shrink-0 text-foreground-warning"
              absoluteStrokeWidth
              strokeWidth={3}
            />
          </div>
          <span>Update available</span>
        </div>
        {used.version && used.latestVersion && (
          <span className="flex items-center gap-1 text-xs text-foreground-muted">
            <span className="font-mono">{used.version}</span>
            <ArrowRight className="h-3 w-3 shrink-0" />
            <span className="font-mono">{used.latestVersion}</span>
          </span>
        )}
      </div>
      <CommandRow
        command={updateCommand}
        action={
          <CommandActionButton
            disabled={isUpdatingThis}
            onClick={() => usedMethod && void update(usedMethod)}
          >
            {isUpdatingThis ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Update'}
          </CommandActionButton>
        }
      />
    </div>
  );
}
