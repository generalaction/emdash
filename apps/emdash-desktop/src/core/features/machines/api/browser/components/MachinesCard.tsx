import { PlusIcon, ServerIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useState } from 'react';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import type { SshConfig, SshConnectionUsage } from '@core/primitives/ssh/api';
import { Button } from '@core/primitives/ui/browser/button';
import { toast } from '@core/primitives/ui/browser/use-toast';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { appState } from '@renderer/lib/stores/app-state';
import { MachineRow } from '../../../browser/components/MachineRow';

export const MachinesCard = observer(function MachinesCard() {
  const [usage, setUsage] = useState<SshConnectionUsage>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const openMachineModal = useOpenModal('addSshConnModal');
  const openConfirm = useOpenModal('confirmActionModal');

  const machines = [...appState.machines.connections].sort((a, b) => a.name.localeCompare(b.name));

  const refreshUsage = useCallback(async (): Promise<SshConnectionUsage | null> => {
    try {
      const nextUsage = await (await getDesktopWireClient()).machines.getMachineUsage(undefined);
      setUsage(nextUsage);
      return nextUsage;
    } catch (error) {
      toast({
        title: 'Failed to load SSH connection usage',
        description: String(error),
        variant: 'destructive',
      });
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshUsage();
  }, [machines.length, refreshUsage]);

  const openAddModal = () => {
    void openMachineModal({
      dismissControl: 'close',
    }).then((outcome) => {
      if (outcome.success) void refreshUsage();
    });
  };

  const openEditModal = (machine: SshConfig) => {
    void openMachineModal({
      dismissControl: 'close',
      initialConfig: machine,
    }).then((outcome) => {
      if (outcome.success) void refreshUsage();
    });
  };

  const deleteMachine = async (machine: SshConfig) => {
    setDeletingId(machine.id);
    try {
      await appState.machines.deleteConnection(machine.id);
      await refreshUsage();
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

  const requestDelete = async (machine: SshConfig) => {
    setDeletingId(machine.id);
    const latestUsage = await refreshUsage();
    setDeletingId(null);

    if (!latestUsage) return;

    const projects = latestUsage[machine.id] ?? [];
    if (projects.length > 0) {
      void openConfirm({
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
    if (outcome.success) void deleteMachine(machine);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-sm font-normal text-foreground">SSH connections</h3>
          <p className="text-xs text-foreground-passive">Reusable remote hosts for SSH projects.</p>
        </div>
        <Button type="button" variant="ghost" onClick={openAddModal}>
          <PlusIcon className="size-4" />
          Add
        </Button>
      </div>

      {machines.length === 0 ? (
        <div className="bg-muted/10 flex min-h-48 flex-col items-center justify-center rounded-lg border border-border p-8 text-center">
          <ServerIcon className="mb-3 size-8 text-foreground-passive" />
          <div className="text-sm text-foreground">No SSH connections</div>
          <p className="mt-1 max-w-sm text-xs text-foreground-passive">
            Add a connection to create and manage remote projects.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {machines.map((machine) => {
            const projects = usage[machine.id] ?? [];
            const isDeleting = deletingId === machine.id;

            return (
              <MachineRow
                key={machine.id}
                machine={machine}
                projects={projects}
                isDeleting={isDeleting}
                onEdit={openEditModal}
                onDelete={requestDelete}
              />
            );
          })}
        </div>
      )}
    </div>
  );
});
