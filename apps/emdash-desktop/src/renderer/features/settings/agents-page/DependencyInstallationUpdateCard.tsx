import { ArrowRight, Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { HostDependencyInstallation } from '@renderer/lib/stores/use-host-dependency-installation';
import { UpdateAvailableBadge } from './agent-status-badge';
import { CommandActionButton, CommandRow } from './install-command-row';

export type DependencyInstallationUpdateCardProps = {
  vm: HostDependencyInstallation;
  /** Per-method update command, keyed by the install method string. */
  updateCommands: Record<string, string>;
};

export const DependencyInstallationUpdateCard = observer(function DependencyInstallationUpdateCard({
  vm,
  updateCommands,
}: DependencyInstallationUpdateCardProps) {
  const { used, operation, update } = vm;

  if (!used?.updateAvailable) return null;

  // Derive the install method from the used installation source
  const usedMethod = used.source.kind === 'method' ? used.source.method : null;

  const updateCommand = usedMethod ? (updateCommands[usedMethod] ?? null) : null;

  if (!updateCommand) return null;

  const isUpdatingThis =
    operation?.kind === 'update' && (operation.method === usedMethod || operation.method == null);

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
            disabled={isUpdatingThis}
            onClick={() => usedMethod && void update(usedMethod)}
          >
            {isUpdatingThis ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Update'}
          </CommandActionButton>
        }
      />
    </div>
  );
});
