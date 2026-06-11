import type { InstallMethod, InstallOption } from '@emdash/cli-agent-plugins';
import { Check, ChevronDown, Copy, Loader2, MoreHorizontal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useMemo, useState } from 'react';
import { appState } from '@renderer/lib/stores/app-state';
import { Alert } from '@renderer/lib/ui/alert';
import {
  Combobox,
  ComboboxContent,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@renderer/lib/ui/combobox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Input } from '@renderer/lib/ui/input';
import type { DependencyId } from '@shared/core/dependencies';
import {
  InstalledBadge,
  InstallingBadge,
  RecommendedBadge,
  UninstalledBadge,
  UpdateAvailableBadge,
  UpdatingBadge,
  UsedBadge,
} from './agent-status-badge';

/** Synthetic option keys that represent user-override sources, not plugin-defined methods. */
type SyntheticSource = 'path' | 'cli';
type SelectionValue = InstallMethod | SyntheticSource;

type InstallSelectOption = {
  value: SelectionValue;
  label: string;
  recommended?: boolean;
};

function humanizeMethod(method: InstallMethod): string {
  const labels: Record<InstallMethod, string> = {
    'installer-macos': 'macOS Installer',
    'installer-windows': 'Windows Installer',
    'installer-linux': 'Linux Installer',
    homebrew: 'Homebrew',
    winget: 'winget',
    powershell: 'PowerShell',
    npm: 'npm',
    apt: 'apt',
    curl: 'curl',
    pip: 'pip',
    cargo: 'cargo',
    other: 'Other',
  };
  return labels[method] ?? method;
}

function CopyButton({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [command]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="shrink-0 rounded p-1 text-foreground-passive opacity-0 transition-opacity group-hover:opacity-100 hover:bg-background-2 hover:text-foreground"
      aria-label="Copy command"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-foreground-success" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function CommandRow({ command, action }: { command: string; action: React.ReactNode }) {
  return (
    <div className="flex w-full items-stretch gap-[2px]">
      <div className="group flex min-w-0 flex-1 items-center gap-2 rounded-l-lg bg-background-quaternary-1 px-2 py-1.5">
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground-muted">
          {command}
        </code>
        <CopyButton command={command} />
      </div>
      {action}
    </div>
  );
}

function CommandActionButton({ ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="group flex items-center gap-2 rounded-r-lg bg-background-quaternary-1 px-4 text-sm hover:bg-background-quaternary-2 disabled:cursor-not-allowed disabled:text-foreground-passive disabled:hover:bg-background-quaternary-1"
      {...props}
    />
  );
}

import type { HostDependencySelection } from '@shared/core/dependencies';

export type InstallSectionProps = {
  agentId: string;
  installOptions: InstallOption[];
  installDocs: string | null;
  isInstalled: boolean;
  updateAvailable: boolean;
  /** SSH connection id; when provided, install/update/status operate on the remote host. */
  connectionId?: string;
  /**
   * ID of the currently-selected installation (from agentPayload.usedId or HostDependency.usedId).
   * Maps to: 'method:<InstallMethod>', 'path', 'cli', or 'auto'.
   */
  usedInstallationId?: string | null;
  /** Path value from the 'path' installation override (agentPayload.installations). */
  pathValue?: string | null;
  /** CLI value from the 'cli' installation override (agentPayload.installations). */
  cliValue?: string | null;
  /** Called when the user clicks "Use this installation". */
  onUseInstallation?: (selection: HostDependencySelection) => void;
  /**
   * When true, the synthetic "CLI Override" and "Path Override" select entries are hidden
   * and the triple-dot "Use this installation" menu is suppressed.
   * Use in the uninstalled view where these overrides are not meaningful.
   */
  hideOverrideOptions?: boolean;
};

export const InstallSection = observer(function InstallSection({
  agentId,
  installOptions,
  isInstalled,
  updateAvailable,
  connectionId,
  usedInstallationId,
  pathValue,
  cliValue,
  onUseInstallation,
  hideOverrideOptions = false,
}: InstallSectionProps) {
  const isInstallingAny = appState.dependencies.isInstalling(agentId as DependencyId, connectionId);
  const currentOp = appState.dependencies.getOperation(agentId as DependencyId, connectionId);

  const [localPath, setLocalPath] = useState(pathValue ?? '');
  const [localCli, setLocalCli] = useState(cliValue ?? '');

  // Derive the current SelectionValue from usedInstallationId.
  // usedInstallationId is 'method:<InstallMethod>', 'path', 'cli', or 'auto'.
  const resolvedInstallSource = useMemo<SelectionValue | null>(() => {
    if (!usedInstallationId) return null;
    if (usedInstallationId === 'path' || usedInstallationId === 'cli')
      return usedInstallationId as SelectionValue;
    if (usedInstallationId.startsWith('method:'))
      return usedInstallationId.slice('method:'.length) as InstallMethod;
    return null;
  }, [usedInstallationId]);

  const defaultSelection = useMemo<SelectionValue>(() => {
    if (resolvedInstallSource) return resolvedInstallSource;
    const recommended = installOptions.find((o) => o.recommended);
    if (recommended) return recommended.method;
    return installOptions[0]?.method ?? 'path';
  }, [resolvedInstallSource, installOptions]);

  const [selectedValue, setSelectedValue] = useState<SelectionValue>(defaultSelection);

  const activeOption = useMemo((): InstallOption | null => {
    if (selectedValue === 'path' || selectedValue === 'cli') return null;
    return installOptions.find((o) => o.method === selectedValue) ?? installOptions[0] ?? null;
  }, [selectedValue, installOptions]);

  // Derive the currently-updating method from the store (replaces local updatingMethod state).
  const updatingMethod = currentOp?.kind === 'update' ? (currentOp.method ?? null) : null;

  const handleInstall = useCallback(
    async (method: InstallMethod) => {
      if (isInstallingAny) return;
      await appState.dependencies.install(agentId as DependencyId, connectionId, method);
    },
    [agentId, connectionId, isInstallingAny]
  );

  const handleUpdate = useCallback(
    async (method: InstallMethod) => {
      if (updatingMethod) return;
      await appState.dependencies.update(agentId as DependencyId, connectionId, method);
    },
    [agentId, connectionId, updatingMethod]
  );

  const handleUseInstallation = useCallback(() => {
    if (!onUseInstallation) return;
    if (selectedValue === 'path') {
      onUseInstallation({ usedId: 'path', path: localPath });
    } else if (selectedValue === 'cli') {
      onUseInstallation({ usedId: 'cli', cli: localCli });
    } else {
      onUseInstallation({ usedId: `method:${selectedValue}` });
    }
  }, [onUseInstallation, selectedValue, localPath, localCli]);

  const isActiveSource = (value: SelectionValue): boolean => {
    if (!resolvedInstallSource) {
      // default: check if this is the recommended/first option
      const defaultOpt = installOptions.find((o) => o.recommended) ?? installOptions[0];
      return value === (defaultOpt?.method ?? 'path');
    }
    return value === resolvedInstallSource;
  };

  const selectedIsActiveSource = isActiveSource(selectedValue);
  const selectedIsInstalled = selectedIsActiveSource && isInstalled;
  const selectedUpdateAvailable = selectedIsActiveSource && updateAvailable;

  const allSelectOptions: InstallSelectOption[] = [
    ...installOptions.map((opt) => ({
      value: opt.method as SelectionValue,
      label: opt.label ?? humanizeMethod(opt.method),
      recommended: opt.recommended,
    })),
    ...(hideOverrideOptions
      ? []
      : ([
          { value: 'cli' as SyntheticSource, label: 'CLI Override' },
          { value: 'path' as SyntheticSource, label: 'Path Override' },
        ] satisfies InstallSelectOption[])),
  ];

  const selectedOption =
    allSelectOptions.find((o) => o.value === selectedValue) ?? allSelectOptions[0];

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Combobox
          value={selectedOption ?? null}
          onValueChange={(opt) => {
            if (opt) setSelectedValue(opt.value);
          }}
          isItemEqualToValue={(a: InstallSelectOption, b: InstallSelectOption) =>
            a.value === b.value
          }
        >
          <ComboboxTrigger className="flex items-center gap-1 rounded-md px-2 py-0.5 text-sm text-foreground-muted transition-colors hover:bg-background-quaternary-2 hover:text-foreground">
            <span className="truncate">{selectedOption?.label ?? selectedValue}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
          </ComboboxTrigger>
          <ComboboxContent align="start" className="w-auto min-w-[--anchor-width+48px]">
            <ComboboxList className="p-1!">
              {allSelectOptions.map((opt) => (
                <ComboboxItem key={opt.value} value={opt} showCheck={false}>
                  <span className="flex items-center gap-1.5">
                    {opt.label}
                    {opt.recommended && <RecommendedBadge />}
                    {isInstalled && opt.value !== 'path' && opt.value !== 'cli' && (
                      <InstalledBadge />
                    )}
                    {isInstalled && installOptions.length > 1 && isActiveSource(opt.value) && (
                      <UsedBadge />
                    )}
                  </span>
                </ComboboxItem>
              ))}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
        <div className="ml-auto flex items-center gap-1.5">
          {onUseInstallation &&
            !hideOverrideOptions &&
            selectedIsInstalled &&
            !selectedIsActiveSource && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="rounded p-1 text-foreground-passive hover:bg-background-2 hover:text-foreground"
                  aria-label="Installation options"
                >
                  <MoreHorizontal className="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={handleUseInstallation}>
                    Use this installation
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          {isInstalled && installOptions.length > 1 && selectedIsActiveSource && <UsedBadge />}
          {currentOp?.kind === 'install' ? (
            <InstallingBadge />
          ) : currentOp?.kind === 'update' ? (
            <UpdatingBadge />
          ) : (
            <>
              {selectedUpdateAvailable && <UpdateAvailableBadge />}
              {selectedIsInstalled ? <InstalledBadge /> : <UninstalledBadge />}
            </>
          )}
        </div>
      </div>

      {/* Selection content */}
      {selectedValue === 'path' && (
        <div className="space-y-1.5">
          <Input
            value={localPath}
            onChange={(e) => setLocalPath(e.target.value)}
            placeholder="/usr/local/bin/claude"
            className="font-mono text-sm"
          />
          <Alert variant="warning">
            Using an absolute path to the agent binary overrides auto-resolution and disables
            emdash's ability to update the agent
          </Alert>
        </div>
      )}

      {selectedValue === 'cli' && (
        <div className="space-y-1.5">
          <Input
            value={localCli}
            onChange={(e) => setLocalCli(e.target.value)}
            placeholder="claude"
            className="font-mono text-sm"
          />
          <Alert variant="warning">
            Enter the command name or binary resolved on PATH. This overrides auto-resolution and
            disables emdash's ability to update the agent
          </Alert>
        </div>
      )}

      {/* Plugin-defined install method commands */}
      {activeOption && (!selectedIsInstalled || selectedUpdateAvailable) && (
        <div className="space-y-2">
          {!selectedIsInstalled && (
            <CommandRow
              command={activeOption.command}
              action={
                <CommandActionButton
                  disabled={isInstallingAny}
                  onClick={() => void handleInstall(activeOption.method)}
                >
                  {isInstallingAny ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Install'}
                </CommandActionButton>
              }
            />
          )}

          {selectedUpdateAvailable &&
            activeOption.updateCommand &&
            (() => {
              const isUpdatingThisMethod =
                currentOp?.kind === 'update' && currentOp.method === activeOption.method;
              return (
                <CommandRow
                  command={activeOption.updateCommand}
                  action={
                    <CommandActionButton
                      disabled={isUpdatingThisMethod || isInstallingAny}
                      onClick={() => void handleUpdate(activeOption.method)}
                    >
                      {isUpdatingThisMethod ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        'Update'
                      )}
                    </CommandActionButton>
                  }
                />
              );
            })()}
        </div>
      )}
    </div>
  );
});
