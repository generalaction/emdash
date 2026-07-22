import { ListPage, PageLayout } from '@emdash/ui/react/patterns';
import { Button, SearchInput } from '@emdash/ui/react/primitives';
import { PlusIcon, ServerIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import type { ConnectionState, SshConfig } from '@core/primitives/ssh/api';
import { toast } from '@core/primitives/ui/browser/use-toast';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { appState } from '@renderer/lib/stores/app-state';
import { MachineListRow } from '../components/machine-list-row';
import { MachineDetailsSheet } from '../machine-details-sheet';

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

export const MachinesSettingsPage = observer(function MachinesSettingsPage() {
  const machinesStore = appState.machines;
  const openConfirm = useOpenModal('confirmActionModal');
  const openMachineModal = useOpenModal('addSshConnModal');
  const [search, setSearch] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsMachine, setDetailsMachine] = useState<SshConfig | undefined>();
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  const openDetails = (machine: SshConfig) => {
    setDetailsMachine(machine);
    setDetailsOpen(true);
  };

  const editConnectionSettings = (machine: SshConfig) => {
    void openMachineModal({ dismissControl: 'close', initialConfig: machine });
  };

  const connectMachine = async (machine: SshConfig) => {
    try {
      await machinesStore.connect(machine.id);
    } catch (error) {
      toast({
        title: 'Failed to connect to machine',
        description: String(error),
        variant: 'destructive',
      });
    }
  };

  const disconnectMachine = async (machine: SshConfig) => {
    try {
      await machinesStore.disconnect(machine.id);
    } catch (error) {
      toast({
        title: 'Failed to disconnect from machine',
        description: String(error),
        variant: 'destructive',
      });
    }
  };

  const requestDelete = async (machine: SshConfig) => {
    setDeletingId(machine.id);
    try {
      const usage = await (await getDesktopWireClient()).machines.getMachineUsage(undefined);
      const projects = usage[machine.id] ?? [];

      if (projects.length > 0) {
        await openConfirm({
          title: 'Cannot delete SSH connection',
          description:
            'This SSH connection is still used by at least one project. Change those projects to another connection before deleting it.',
          confirmLabel: 'Close',
        });
        return;
      }

      const outcome = await openConfirm({
        title: 'Delete SSH connection',
        description: `This will remove "${machine.name}" and its saved credentials from this device.`,
        confirmLabel: 'Delete',
        variant: 'destructive',
      });
      if (!outcome.success) return;

      await machinesStore.deleteConnection(machine.id);
      setDetailsOpen(false);
      setDetailsMachine(undefined);
    } catch (error) {
      toast({
        title: 'Failed to delete SSH connection',
        description: String(error),
        variant: 'destructive',
      });
    } finally {
      setDeletingId(null);
    }
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
                    <MachineListRow key={machine.id} machine={machine} onSelect={openDetails} />
                  ))}
                </ListPage.Section>
              )}

              {recentlyUsed.length > 0 && other.length > 0 && <ListPage.Separator />}

              {other.length > 0 && (
                <ListPage.Section>
                  <ListPage.SectionHeader label="Other" count={other.length} />
                  {other.map((machine) => (
                    <MachineListRow key={machine.id} machine={machine} onSelect={openDetails} />
                  ))}
                </ListPage.Section>
              )}
            </>
          )}
        </ListPage.Body>
      </ListPage>

      <MachineDetailsSheet
        open={detailsOpen}
        machine={detailsMachine}
        deleting={deletingId === detailsMachine?.id}
        onOpenChange={setDetailsOpen}
        onConnect={connectMachine}
        onDisconnect={disconnectMachine}
        onEditConnectionSettings={editConnectionSettings}
        onDelete={requestDelete}
      />
    </div>
  );
});
