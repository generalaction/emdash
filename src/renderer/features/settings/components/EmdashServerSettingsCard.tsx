import { PlusIcon, ServerIcon } from 'lucide-react';
import { useCallback } from 'react';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import type { EmdashServerConnection } from '@main/core/settings/schema';
import { useAppSettingsKey } from '../use-app-settings-key';
import { EmdashServerRow } from './EmdashServerRow';

export function EmdashServerSettingsCard() {
  const { value: servers = [], update, isLoading } = useAppSettingsKey('rundashServers');
  const showModal = useShowModal('rundashServerModal');
  const showConfirm = useShowModal('confirmActionModal');

  const openAdd = useCallback(() => {
    showModal({
      onSuccess: (server: EmdashServerConnection) => {
        update([...servers, server] as typeof servers);
      },
    });
  }, [showModal, servers, update]);

  const openEdit = useCallback(
    (server: EmdashServerConnection) => {
      showModal({
        initialServer: server,
        onSuccess: (updated: EmdashServerConnection) => {
          update(servers.map((s) => (s.id === updated.id ? updated : s)) as typeof servers);
        },
      });
    },
    [showModal, servers, update]
  );

  const requestDelete = useCallback(
    (server: EmdashServerConnection) => {
      showConfirm({
        title: 'Remove server connection',
        description: `This will remove "${server.label}" from Emdash. The server itself will not be affected.`,
        confirmLabel: 'Remove',
        variant: 'destructive',
        onSuccess: () => {
          update(servers.filter((s) => s.id !== server.id) as typeof servers);
        },
      });
    },
    [showConfirm, servers, update]
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-sm font-normal text-foreground">Emdash servers</h3>
          <p className="text-xs text-foreground-passive">
            Self-hosted servers that receive webhooks and trigger automations.
          </p>
        </div>
        <Button type="button" variant="ghost" onClick={openAdd} disabled={isLoading}>
          <PlusIcon className="size-4" />
          Add
        </Button>
      </div>

      {servers.length === 0 ? (
        <div className="bg-muted/10 flex min-h-48 flex-col items-center justify-center rounded-lg border border-border p-8 text-center">
          <ServerIcon className="mb-3 size-8 text-foreground-passive" />
          <div className="text-sm text-foreground">No servers configured</div>
          <p className="mt-1 max-w-sm text-xs text-foreground-passive">
            Add an rundash-server connection to enable webhook-triggered automations.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {servers.map((server) => (
            <EmdashServerRow
              key={server.id}
              server={server}
              onEdit={openEdit}
              onDelete={requestDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
