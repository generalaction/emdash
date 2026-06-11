import type { InstallMethod, InstallOption } from '@emdash/cli-agent-plugins';
import { Check, ChevronDown, Copy, ExternalLink, MoreHorizontal, Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useMemo, useState } from 'react';
import { appState } from '@renderer/lib/stores/app-state';
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
import {
  InstalledBadge,
  RecommendedBadge,
  UninstalledBadge,
  UpdateAvailableBadge,
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
      <div className="group flex flex-1 items-center gap-2 rounded-l-lg bg-background-quaternary-1 min-w-0 px-2 py-1.5">
        <Terminal className="h-3.5 w-3.5 shrink-0 text-foreground-passive" />
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground-muted">
          {command}
        </code>
        <CopyButton command={command} />
      </div>
      {action}
    </div>
  );
}

function CommandActionButton({ ...props }: React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="group flex items-center gap-2 rounded-r-lg bg-background-quaternary-1 px-4 text-sm hover:bg-background-quaternary-2"
      {...props}
    />
  );
}

export type UseInstallationPayload = {
  installSource: string;
  path?: string;
  cli?: string;
};

export type InstallSectionProps = {
  agentId: string;
  installOptions: InstallOption[];
  installDocs: string | null;
  isInstalled: boolean;
  updateAvailable: boolean;
  /** Currently persisted install source (installSource value from storedConfig). */
  installSource?: string | null;
  /** Currently persisted custom path override. */
  pathValue?: string | null;
  /** Currently persisted CLI override. */
  cliValue?: string | null;
  /** Called when the user clicks "Use this installation". */
  onUseInstallation?: (payload: UseInstallationPayload) => void;
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
  installDocs,
  isInstalled,
  updateAvailable,
  installSource,
  pathValue,
  cliValue,
  onUseInstallation,
  hideOverrideOptions = false,
}: InstallSectionProps) {
  const isInstallingAny = appState.dependencies.isInstalling(agentId as never);
  const [updatingMethod, setUpdatingMethod] = useState<InstallMethod | null>(null);

  // Local input state for path/cli synthetic options
  const [localPath, setLocalPath] = useState(pathValue ?? '');
  const [localCli, setLocalCli] = useState(cliValue ?? '');

  // Resolve the default selection:
  // 1. persisted installSource, 2. recommended method, 3. first method option
  const defaultSelection = useMemo<SelectionValue>(() => {
    if (installSource) return installSource as SelectionValue;
    const recommended = installOptions.find((o) => o.recommended);
    if (recommended) return recommended.method;
    return installOptions[0]?.method ?? 'path';
  }, [installSource, installOptions]);

  const [selectedValue, setSelectedValue] = useState<SelectionValue>(defaultSelection);

  const activeOption = useMemo((): InstallOption | null => {
    if (selectedValue === 'path' || selectedValue === 'cli') return null;
    return installOptions.find((o) => o.method === selectedValue) ?? installOptions[0] ?? null;
  }, [selectedValue, installOptions]);

  const handleInstall = useCallback(
    async (method: InstallMethod) => {
      if (isInstallingAny) return;
      await appState.dependencies.install(agentId as never, undefined, method);
    },
    [agentId, isInstallingAny]
  );

  const handleUpdate = useCallback(
    async (method: InstallMethod) => {
      if (updatingMethod) return;
      setUpdatingMethod(method);
      try {
        await appState.dependencies.update(agentId as never, undefined, method);
      } finally {
        setUpdatingMethod(null);
      }
    },
    [agentId, updatingMethod]
  );

  const handleUseInstallation = useCallback(() => {
    if (!onUseInstallation) return;
    if (selectedValue === 'path') {
      onUseInstallation({ installSource: 'path', path: localPath });
    } else if (selectedValue === 'cli') {
      onUseInstallation({ installSource: 'cli', cli: localCli });
    } else {
      onUseInstallation({ installSource: selectedValue });
    }
  }, [onUseInstallation, selectedValue, localPath, localCli]);

  const isActiveSource = (value: SelectionValue): boolean => {
    if (!installSource) {
      // default: check if this is the recommended/first option
      const defaultOpt = installOptions.find((o) => o.recommended) ?? installOptions[0];
      return value === (defaultOpt?.method ?? 'path');
    }
    return value === (installSource as SelectionValue);
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

  const docsLink = installDocs ? (
    <a
      href={installDocs}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground hover:underline"
    >
      Installation Docs
      <ExternalLink className="h-3 w-3" />
    </a>
  ) : null;

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
                      {isInstalled && installOptions.length > 1 && isActiveSource(opt.value) && <UsedBadge />}
                    </span>
                  </ComboboxItem>
                ))}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          <div className="ml-auto flex items-center gap-1.5">
            {onUseInstallation && !hideOverrideOptions && selectedIsInstalled && !selectedIsActiveSource && (
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
            {selectedUpdateAvailable && <UpdateAvailableBadge />}
            {selectedIsInstalled ? <InstalledBadge /> : <UninstalledBadge />}
          </div>
        </div>

        {/* Selection content */}
        {selectedValue === 'path' && (
          <div className="space-y-1.5">
            <p className="text-xs text-foreground-muted">
              Absolute path to the agent binary. Overrides auto-resolution.
            </p>
            <Input
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              placeholder="/usr/local/bin/claude"
              className="font-mono text-sm"
            />
          </div>
        )}

        {selectedValue === 'cli' && (
          <div className="space-y-1.5">
            <p className="text-xs text-foreground-muted">
              Command name or binary resolved on PATH. Overrides the default binary name.
            </p>
            <Input
              value={localCli}
              onChange={(e) => setLocalCli(e.target.value)}
              placeholder="claude"
              className="font-mono text-sm"
            />
          </div>
        )}

        {/* Plugin-defined install method commands */}
        {activeOption && (!selectedIsInstalled || selectedUpdateAvailable) && (
          <div className="space-y-2">
            {!selectedIsInstalled && (
              <CommandRow
                command={activeOption.command}
                action={
                  <CommandActionButton onClick={() => void handleInstall(activeOption.method)}>
                    Install
                  </CommandActionButton>
                }
              />
            )}

            {selectedUpdateAvailable && activeOption.updateCommand && (
              <CommandRow
                command={activeOption.updateCommand}
                action={
                  <CommandActionButton onClick={() => void handleUpdate(activeOption.method)}>
                    Update
                  </CommandActionButton>
                }
              />
            )}
          </div>
        )}
      </div>

  );
});
