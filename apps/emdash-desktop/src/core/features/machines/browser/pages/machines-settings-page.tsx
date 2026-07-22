import { ListPage, PageLayout } from '@emdash/ui/react/patterns';
import { Button, SearchInput } from '@emdash/ui/react/primitives';
import { PlusIcon, ServerIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import type { SettingsPageProps } from '@core/primitives/settings/api/page-contribution';
import type { ConnectionState, SshConfig } from '@core/primitives/ssh/api';
import { appState } from '@renderer/lib/stores/app-state';
import { MachineListRow } from '../components/machine-list-row';

function isRecentlyUsed(state: ConnectionState): boolean {
  return state === 'connected' || state === 'connecting' || state === 'reconnecting';
}

function matchesSearch(machine: SshConfig, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;

  return [machine.name, machine.host, machine.username].some((value) =>
    value.toLocaleLowerCase().includes(normalizedQuery)
  );
}

export const MachinesSettingsPage = observer(function MachinesSettingsPage({
  openDetail,
}: SettingsPageProps) {
  const machinesStore = appState.machines;
  const openMachineModal = useOpenModal('addSshConnModal');
  const [search, setSearch] = useState('');

  const filteredMachines = useMemo(
    () =>
      machinesStore.connections
        .filter((machine) => matchesSearch(machine, search))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [machinesStore.connections, search]
  );
  const recentlyUsed = filteredMachines.filter((machine) =>
    isRecentlyUsed(machinesStore.stateFor(machine.id))
  );
  const other = filteredMachines.filter(
    (machine) => !isRecentlyUsed(machinesStore.stateFor(machine.id))
  );

  const openCreateModal = () => {
    void openMachineModal({ dismissControl: 'close' });
  };

  const hasMachines = machinesStore.connections.length > 0;
  const hasFilteredMachines = filteredMachines.length > 0;

  return (
    <div className="flex min-h-0 flex-col">
      <PageLayout.Header
        sticky
        title="Machines"
        description="Manage reusable machines for remote projects."
        actions={
          <div className="flex items-center justify-between gap-2">
            <SearchInput
              size="sm"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onClear={() => setSearch('')}
              placeholder="Search machines…"
              style={{ width: '14rem' }}
            />
            <Button type="button" variant="primary" size="sm" onClick={openCreateModal}>
              <PlusIcon />
              Add machine
            </Button>
          </div>
        }
      />

      <ListPage>
        <ListPage.Body>
          {!hasFilteredMachines ? (
            <div className="flex min-h-48 flex-col items-center justify-center p-8 text-center">
              <ServerIcon className="mb-3 size-8 text-foreground-passive" />
              <div className="text-sm text-foreground">
                {hasMachines ? 'No machines match your search' : 'No machines'}
              </div>
              <p className="mt-1 max-w-sm text-xs text-foreground-passive">
                {hasMachines
                  ? 'Try a different name, host, or username.'
                  : 'Add a machine to create and manage remote projects.'}
              </p>
            </div>
          ) : (
            <>
              {recentlyUsed.length > 0 && (
                <ListPage.Section>
                  <ListPage.SectionHeader label="Recently used" count={recentlyUsed.length} />
                  {recentlyUsed.map((machine) => (
                    <MachineListRow
                      key={machine.id}
                      machine={machine}
                      onSelect={() => openDetail(machine.id)}
                    />
                  ))}
                </ListPage.Section>
              )}

              {recentlyUsed.length > 0 && other.length > 0 && <ListPage.Separator />}

              {other.length > 0 && (
                <ListPage.Section>
                  <ListPage.SectionHeader label="Other" count={other.length} />
                  {other.map((machine) => (
                    <MachineListRow
                      key={machine.id}
                      machine={machine}
                      onSelect={() => openDetail(machine.id)}
                    />
                  ))}
                </ListPage.Section>
              )}
            </>
          )}
        </ListPage.Body>
      </ListPage>
    </div>
  );
});
