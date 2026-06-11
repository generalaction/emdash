import type { InstallationSource, HostDependencySelection } from '@emdash/shared/deps';
import { Check, MoreHorizontal, RefreshCw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { HostDependencyInstallation } from '@renderer/lib/stores/use-host-dependency-installation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { humanizeMethod } from './install-command-row';

function sourceLabel(source: InstallationSource): string {
  switch (source.kind) {
    case 'method':
      return humanizeMethod(source.method);
    case 'path':
      return source.path;
    case 'cli':
      return source.command;
  }
}

function buildSelection(
  id: string,
  installations: HostDependencyInstallation['installations']
): HostDependencySelection {
  if (id === 'path') {
    const inst = installations.find((i) => i.id === 'path');
    const path = inst?.source.kind === 'path' ? inst.source.path : '';
    return { usedId: 'path', path };
  }
  if (id === 'cli') {
    const inst = installations.find((i) => i.id === 'cli');
    const cli = inst?.source.kind === 'cli' ? inst.source.command : '';
    return { usedId: 'cli', cli };
  }
  return { usedId: id };
}

export type DependencyInstallationStatusCardProps = {
  vm: HostDependencyInstallation;
};

export const DependencyInstallationStatusCard = observer(function DependencyInstallationStatusCard({
  vm,
}: DependencyInstallationStatusCardProps) {
  const { used, installations, setUsed, refresh, fetchLatestVersion } = vm;

  if (!used) return null;

  const label = sourceLabel(used.source);
  const versionText = used.version ? `v${used.version}` : null;

  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
      <div className="bg-background-success-1 flex size-6 items-center justify-center rounded-lg">
        <Check className="size-4 shrink-0 text-foreground-success" />
      </div>
      <div className="min-w-0 flex-1 truncate text-sm">
        <span className="text-foreground">Found</span>
        {versionText && <span className="ml-1 font-mono text-foreground-muted">{versionText}</span>}
        <span className="ml-1 text-foreground-muted">using</span>
        <span className="ml-1 font-medium text-foreground">{label}</span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="shrink-0 rounded p-1 text-foreground-passive hover:bg-background-2 hover:text-foreground"
          aria-label="Installation options"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {installations.length > 1 && (
            <>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Change used</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuLabel>Select installation</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {installations.map((inst) => (
                    <DropdownMenuItem
                      key={inst.id}
                      onSelect={() => setUsed(buildSelection(inst.id, installations))}
                    >
                      {sourceLabel(inst.source)}
                      {inst.id === used.id && (
                        <span className="ml-auto text-xs text-foreground-passive">current</span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onSelect={() => refresh()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => fetchLatestVersion()}>
            Check for updates
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});
