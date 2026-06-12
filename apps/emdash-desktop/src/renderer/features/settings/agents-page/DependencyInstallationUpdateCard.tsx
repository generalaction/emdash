import { ArrowRight, Loader2 } from 'lucide-react';
import type { HostDependencyInstallation } from '@renderer/lib/stores/use-host-dependency-installation';
import { UpdateAvailableBadge } from './agent-status-badge';
import { CommandActionButton, CommandRow } from './install-command-row';

export type DependencyInstallationUpdateCardProps = {
  vm: HostDependencyInstallation;
  /** Per-method update command, keyed by the install method string. */
  updateCommands: Record<string, string>;
  /** Whether an update is currently in progress. */
  isUpdating?: boolean;
};

export function DependencyInstallationUpdateCard({
  vm,
  updateCommands,
  isUpdating = false,
}: DependencyInstallationUpdateCardProps) {
  const { used, update } = vm;

  if (!used?.updateAvailable) return null;

  const usedMethod = used.source.kind === 'method' ? used.source.method : null;
  const updateCommand = usedMethod ? (updateCommands[usedMethod] ?? null) : null;

  if (!updateCommand) return null;

  return (
    <div className="space-y-2 rounded-lg border border-border-warning p-3">
      <div className="flex items-center gap-2">
        <UpdateAvailableBadge />
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
            disabled={isUpdating}
            onClick={() => usedMethod && void update(usedMethod)}
          >
            {isUpdating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Update'}
          </CommandActionButton>
        }
      />
    </div>
  );
}
