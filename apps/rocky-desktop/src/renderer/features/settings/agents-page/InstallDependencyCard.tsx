import { Loader2 } from 'lucide-react';
import type { HostDependencyInstallation } from '@renderer/lib/stores/use-agent-installation-statuses';
import { cn } from '@renderer/utils/utils';
import type { InstallMethod, InstallOption } from '@shared/core/agents/agent-payload';
import { CommandActionButton, CommandRow } from './install-command-row';

export type InstallDependencyCardProps = {
  vm: HostDependencyInstallation;
  /** The filtered install options to display. Parent passes the relevant method(s). */
  installOptions: InstallOption[];
  /** Whether an install is currently in progress (any method). */
  isInstalling?: boolean;
  /** The install method currently being installed, if any. */
  installingMethod?: InstallMethod;
  /** Additional class name for the container. */
  className?: string;
};

/**
 * Renders one or more install command rows for the provided install options.
 * Source selection is owned by InstallSection; this card only fires vm.install.
 */
export function InstallDependencyCard({
  vm,
  installOptions,
  isInstalling = false,
  installingMethod,
  className,
}: InstallDependencyCardProps) {
  const { install } = vm;

  if (installOptions.length === 0) return null;

  return (
    <div className={cn('space-y-2 rounded-lg border p-3', className)}>
      <div className="text-sm text-foreground-muted">Install</div>
      {installOptions.map((opt) => {
        const isInstallingThis =
          isInstalling && (installingMethod === undefined || installingMethod === opt.method);
        return (
          <CommandRow
            key={opt.method}
            command={opt.command}
            action={
              <CommandActionButton disabled={isInstalling} onClick={() => void install(opt.method)}>
                {isInstallingThis ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Install'}
              </CommandActionButton>
            }
          />
        );
      })}
    </div>
  );
}
