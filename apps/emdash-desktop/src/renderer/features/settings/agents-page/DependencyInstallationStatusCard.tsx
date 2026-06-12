import type { InstallationSource, HostDependencySelection } from '@emdash/shared/deps/runtime';
import { Check, MoreHorizontal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { HostDependencyInstallation } from '@renderer/lib/stores/use-agent-installation-statuses';
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
    <div className="flex items-center gap-2 rounded-lg border p-3">
      <div className="flex size-6 items-center justify-center rounded-lg bg-background-success">
        <Check
          className="size-3.5 shrink-0 text-foreground-success"
          absoluteStrokeWidth
          strokeWidth={3}
        />
      </div>
      <div className="min-w-0 flex-1 truncate text-sm">
        <span>Found</span>
        {versionText && (
          <span className="ml-1 rounded-md bg-background-quaternary-2 px-1 py-0.5 font-mono text-xs text-foreground-muted">
            {versionText}
          </span>
        )}
        <span className="ml-1">installed using {label}</span>
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
          <DropdownMenuItem onSelect={() => refresh()}>Refresh</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => fetchLatestVersion()}>
            Check for updates
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});
