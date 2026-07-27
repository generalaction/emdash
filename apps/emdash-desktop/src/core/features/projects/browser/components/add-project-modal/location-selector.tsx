import { MachineStatus } from '@emdash/ui/react/components';
import type { MachineStatusKind } from '@emdash/ui/react/components';
import { DropdownMenu, SearchInput, TriggerButton } from '@emdash/ui/react/primitives';
import { CheckIcon, HomeIcon, SettingsIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { SshConfig } from '@core/primitives/ssh/api';
import type { Strategy } from './add-project-modal';

type MachineOption = SshConfig & { id: string };

interface LocationSelectorProps {
  strategy: Strategy;
  connectionId?: string;
  machines: MachineOption[];
  getMachineStatusKind: (machineId: string | undefined) => MachineStatusKind;
  onSelectLocal: () => void;
  onSelectMachine: (connectionId: string) => void;
  onManageMachines: () => void;
}

export function LocationSelector({
  strategy,
  connectionId,
  machines,
  getMachineStatusKind,
  onSelectLocal,
  onSelectMachine,
  onManageMachines,
}: LocationSelectorProps) {
  const [query, setQuery] = useState('');
  const selectedMachine = connectionId
    ? machines.find((machine) => machine.id === connectionId)
    : undefined;
  const filteredMachines = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return machines;
    return machines.filter((machine) => machine.name.toLowerCase().includes(normalizedQuery));
  }, [machines, query]);
  const triggerStatus = getMachineStatusKind(strategy === 'ssh' ? connectionId : undefined);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        render={
          <TriggerButton
            appearance="input"
            size="sm"
            tone="neutral"
            className="max-w-34 min-w-24 justify-between"
            aria-label="Project location"
          >
            <span className="flex min-w-0 items-center gap-2">
              {strategy === 'ssh' ? (
                <>
                  <MachineStatus status={triggerStatus} size="0.75rem" />
                  <span className="min-w-0 truncate">{selectedMachine?.name ?? 'Remote'}</span>
                </>
              ) : (
                <>
                  <HomeIcon className="size-3" />
                  <span>Local</span>
                </>
              )}
            </span>
          </TriggerButton>
        }
      />
      <DropdownMenu.Content align="end" sideOffset={6} style={{ minWidth: '20rem' }}>
        <DropdownMenu.Item className="items-start py-2" onClick={onSelectLocal}>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium">Local</span>
            <span className="text-xs text-foreground-muted">Add a project from this computer.</span>
          </div>
          {strategy === 'local' && <CheckIcon className="mt-0.5 ml-auto size-4" />}
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger className="items-start py-2">
            <RemoteLocationSummary
              machine={selectedMachine}
              status={getMachineStatusKind(selectedMachine?.id)}
            />
          </DropdownMenu.SubTrigger>
          <DropdownMenu.SubContent className="p-1" sideOffset={4} style={{ minWidth: '20rem' }}>
            <div className="px-1 pb-1">
              <SearchInput
                size="sm"
                value={query}
                placeholder="Filter machines..."
                onChange={(event) => setQuery(event.target.value)}
                onClear={() => setQuery('')}
                onKeyDown={(event) => {
                  if (
                    event.key !== 'Escape' &&
                    event.key !== 'ArrowDown' &&
                    event.key !== 'ArrowUp'
                  ) {
                    event.stopPropagation();
                  }
                }}
              />
            </div>
            {filteredMachines.length > 0 ? (
              filteredMachines.map((machine) => (
                <MachineLocationItem
                  key={machine.id}
                  machine={machine}
                  status={getMachineStatusKind(machine.id)}
                  selected={strategy === 'ssh' && machine.id === connectionId}
                  onSelect={() => onSelectMachine(machine.id)}
                />
              ))
            ) : (
              <p className="px-2 py-2 text-xs text-foreground-muted">No machines found.</p>
            )}
            <DropdownMenu.Separator />
            <DropdownMenu.Item onClick={onManageMachines}>
              <SettingsIcon className="size-4" />
              Manage machines
            </DropdownMenu.Item>
          </DropdownMenu.SubContent>
        </DropdownMenu.Sub>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

function RemoteLocationSummary({
  machine,
  status,
}: {
  machine: MachineOption | undefined;
  status: MachineStatusKind;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 pr-2">
      <span className="font-medium">Remote</span>
      <span className="text-xs text-foreground-muted">Add a project from a remote machine.</span>
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-foreground-muted">
        {machine ? (
          <>
            <MachineStatus status={status} size="0.875rem" />
            <span className="min-w-0 truncate">{machine.name}</span>
          </>
        ) : (
          'Select a remote machine'
        )}
      </span>
    </div>
  );
}

function MachineLocationItem({
  machine,
  status,
  selected,
  onSelect,
}: {
  machine: MachineOption;
  status: MachineStatusKind;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenu.Item onClick={onSelect}>
      <MachineStatus status={status} size="1rem" />
      <span className="min-w-0 truncate">{machine.name}</span>
      {selected && <CheckIcon className="ml-auto size-4" />}
    </DropdownMenu.Item>
  );
}
