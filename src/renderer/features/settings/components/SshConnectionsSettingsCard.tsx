import { PlusIcon, ServerIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useState } from 'react';
import type { SshConfig, SshConnectionUsage } from '@shared/ssh';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { SshConnectionRow } from './SshConnectionRow';

export const SshConnectionsSettingsCard = observer(function SshConnectionsSettingsCard() {
  const [usage, setUsage] = useState<SshConnectionUsage>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const showSshConnModal = useShowModal('addSshConnModal');
  const showConfirm = useShowModal('confirmActionModal');

  const connections = [...appState.sshConnections.connections].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const refreshUsage = useCallback(async (): Promise<SshConnectionUsage | null> => {
    try {
      const nextUsage = await rpc.ssh.getConnectionUsage();
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
  }, [connections.length, refreshUsage]);

  const openAddModal = () => {
    showSshConnModal({
      dismissControl: 'close',
      onSuccess: () => {
        void refreshUsage();
      },
    });
  };

  const openEditModal = (connection: SshConfig) => {
    showSshConnModal({
      dismissControl: 'close',
      initialConfig: connection,
      onSuccess: () => {
        void refreshUsage();
      },
    });
  };

  const deleteConnection = async (connection: SshConfig) => {
    setDeletingId(connection.id);
    try {
      await appState.sshConnections.deleteConnection(connection.id);
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

  const requestDelete = async (connection: SshConfig) => {
    const latestUsage = await refreshUsage();
    if (!latestUsage) return;

    const projects = latestUsage[connection.id] ?? [];
    if (projects.length > 0) {
      showConfirm({
        title: 'Cannot delete SSH connection',
        description:
          'This SSH connection is still used by at least one project. Change those projects to another connection before deleting it.',
        confirmLabel: 'Close',
      });
      return;
    }

    showConfirm({
      title: 'Delete SSH connection',
      description: `This will remove "${connection.name}" and its saved credentials from this device.`,
      confirmLabel: 'Delete',
      variant: 'destructive',
      onSuccess: () => {
        void deleteConnection(connection);
      },
    });
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

      {connections.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-border bg-muted/10 p-8 text-center">
          <ServerIcon className="mb-3 size-8 text-foreground-passive" />
          <div className="text-sm text-foreground">No SSH connections</div>
          <p className="mt-1 max-w-sm text-xs text-foreground-passive">
            Add a connection to create and manage remote projects.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {connections.map((connection) => {
            const projects = usage[connection.id] ?? [];
            const isDeleting = deletingId === connection.id;

            return (
              <SshConnectionRow
                key={connection.id}
                connection={connection}
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
