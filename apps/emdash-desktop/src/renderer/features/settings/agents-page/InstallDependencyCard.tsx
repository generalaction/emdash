import type { InstallMethod, InstallOption } from '@emdash/shared/deps';
import { ChevronDown, Loader2 } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import type { HostDependencyInstallation } from '@renderer/lib/stores/use-host-dependency-installation';
import { Alert } from '@renderer/lib/ui/alert';
import {
  Combobox,
  ComboboxContent,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@renderer/lib/ui/combobox';
import { Input } from '@renderer/lib/ui/input';
import { InstalledBadge, RecommendedBadge, UsedBadge } from './agent-status-badge';
import { CommandActionButton, CommandRow, humanizeMethod } from './install-command-row';

/** Synthetic option keys that represent user-override sources, not plugin-defined methods. */
type SyntheticSource = 'path' | 'cli';
type SelectionValue = InstallMethod | SyntheticSource;

type InstallSelectOption = {
  value: SelectionValue;
  label: string;
  recommended?: boolean;
};

export type InstallDependencyCardProps = {
  vm: HostDependencyInstallation;
  installOptions: InstallOption[];
  /** When true, the synthetic "CLI Override" and "Path Override" entries are hidden. */
  hideOverrideOptions?: boolean;
  /** Current persisted path override value for initialising the path input. */
  initialPath?: string;
  /** Current persisted cli override value for initialising the cli input. */
  initialCli?: string;
  /** Whether an install is currently in progress. */
  isInstalling?: boolean;
};

export function InstallDependencyCard({
  vm,
  installOptions,
  hideOverrideOptions = false,
  initialPath = '',
  initialCli = '',
  isInstalling = false,
}: InstallDependencyCardProps) {
  const { install, installations } = vm;

  const defaultSelection = useMemo<SelectionValue>(() => {
    const recommended = installOptions.find((o) => o.recommended);
    if (recommended) return recommended.method;
    return installOptions[0]?.method ?? 'path';
  }, [installOptions]);

  const [selectedValue, setSelectedValue] = useState<SelectionValue>(defaultSelection);
  const [localPath, setLocalPath] = useState(initialPath);
  const [localCli, setLocalCli] = useState(initialCli);

  const activeOption = useMemo((): InstallOption | null => {
    if (selectedValue === 'path' || selectedValue === 'cli') return null;
    return installOptions.find((o) => o.method === selectedValue) ?? installOptions[0] ?? null;
  }, [selectedValue, installOptions]);

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

  const usedInstallId = vm.used?.id;
  const isSelectedUsed = (value: SelectionValue) => {
    if (value === 'path') return usedInstallId === 'path';
    if (value === 'cli') return usedInstallId === 'cli';
    return usedInstallId === `method:${value}`;
  };

  const isOptionInstalled = (value: SelectionValue) => {
    if (value === 'path' || value === 'cli') return false;
    return installations.some((i) => i.id === `method:${value}` && i.status === 'available');
  };

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
          <ComboboxTrigger
            disabled={isInstalling}
            className="flex items-center gap-1 rounded-md px-2 py-0.5 text-sm text-foreground-muted transition-colors hover:bg-background-quaternary-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
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
                    {isOptionInstalled(opt.value) && <InstalledBadge />}
                    {isSelectedUsed(opt.value) && <UsedBadge />}
                  </span>
                </ComboboxItem>
              ))}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>

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

      {activeOption && (
        <CommandRow
          command={activeOption.command}
          action={
            <CommandActionButton
              disabled={isInstalling}
              onClick={() => void install(activeOption.method)}
            >
              {isInstalling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Install'}
            </CommandActionButton>
          }
        />
      )}
    </div>
  );
}
