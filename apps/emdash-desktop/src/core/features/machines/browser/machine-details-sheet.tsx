import { Button, DropdownMenu, Sheet } from '@emdash/ui/react/primitives';
import { EllipsisIcon, PlugIcon, Trash2Icon, UnplugIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import type { SshConfig } from '@core/primitives/ssh/api';
import { EditableNameField } from '@core/primitives/ui/browser/editable-name-field';
import { toast } from '@core/primitives/ui/browser/use-toast';
import { appState } from '@renderer/lib/stores/app-state';
import { MachineConnectionCard } from './components/machine-connection-card';
import { MachineResources } from './components/machine-resources';
import { MachineWorkspacesByProject } from './components/machine-workspaces-by-project';
import { WorkspaceServerCard } from './components/workspace-server-card';
import { useMachineMetrics } from './use-machine-metrics';
import { useMachineWorkspaces } from './use-machine-workspaces';
import { useRemoteMachineServerState } from './use-remote-machine-server-state';

export const MachineDetailsSheet = observer(function MachineDetailsSheet({
  open,
  machine,
  deleting = false,
  onOpenChange,
  onConnect,
  onDisconnect,
  onEditConnectionSettings,
  onDelete,
}: {
  open: boolean;
  machine?: SshConfig;
  deleting?: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (machine: SshConfig) => void | Promise<void>;
  onDisconnect: (machine: SshConfig) => void | Promise<void>;
  onEditConnectionSettings: (machine: SshConfig) => void;
  onDelete?: (machine: SshConfig) => void | Promise<void>;
}) {
  const currentMachine = machine
    ? (appState.machines.connections.find((connection) => connection.id === machine.id) ?? machine)
    : undefined;
  const state = currentMachine ? appState.machines.stateFor(currentMachine.id) : 'disconnected';
  const connected = state === 'connected';
  const connectionActive = connected || state === 'connecting' || state === 'reconnecting';
  const [name, setName] = useState(currentMachine?.name ?? '');
  const [renaming, setRenaming] = useState(false);
  const workspaceServer = useRemoteMachineServerState({
    machineId: currentMachine?.id,
    enabled: open,
    connected,
  });
  const serverHealthy = workspaceServer.state?.status === 'healthy';
  const metrics = useMachineMetrics(currentMachine?.id, open && serverHealthy);
  const workspaces = useMachineWorkspaces(currentMachine?.id, open && serverHealthy);

  useEffect(() => {
    setName(currentMachine?.name ?? '');
  }, [currentMachine?.id, currentMachine?.name]);

  const commitName = async (value: string) => {
    if (!currentMachine) return;
    const nextName = value.trim();
    if (!nextName || nextName === currentMachine.name) {
      setName(currentMachine.name);
      return;
    }

    setRenaming(true);
    setName(nextName);
    try {
      await appState.machines.renameConnection(currentMachine.id, nextName);
    } catch (error) {
      setName(currentMachine.name);
      toast({
        title: 'Failed to rename machine',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setRenaming(false);
    }
  };

  return (
    <Sheet.Root open={open} onOpenChange={onOpenChange}>
      <Sheet.Content side="right">
        <Sheet.Header>
          <Sheet.Title>Machine Details</Sheet.Title>
        </Sheet.Header>
        <Sheet.Body>
          {currentMachine && (
            <div className="flex flex-col gap-6 pb-4">
              <div className="flex min-w-0 items-center gap-2">
                <EditableNameField
                  value={name}
                  disabled={renaming}
                  className="min-w-0 flex-1"
                  onChange={setName}
                  onBlur={(event) => void commitName(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      event.currentTarget.blur();
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      event.currentTarget.value = currentMachine.name;
                      setName(currentMachine.name);
                      event.currentTarget.blur();
                    }
                  }}
                />
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        icon
                        aria-label="Machine actions"
                      />
                    }
                  >
                    <EllipsisIcon />
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end">
                    <DropdownMenu.Item
                      onClick={() =>
                        void (connectionActive
                          ? onDisconnect(currentMachine)
                          : onConnect(currentMachine))
                      }
                    >
                      {connectionActive ? <UnplugIcon /> : <PlugIcon />}
                      {connectionActive ? 'Disconnect' : 'Connect'}
                    </DropdownMenu.Item>
                    {onDelete && (
                      <>
                        <DropdownMenu.Separator />
                        <DropdownMenu.Item
                          variant="destructive"
                          disabled={deleting}
                          onClick={() => void onDelete(currentMachine)}
                        >
                          <Trash2Icon />
                          {deleting ? 'Deleting…' : 'Delete'}
                        </DropdownMenu.Item>
                      </>
                    )}
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              </div>

              <MachineConnectionCard
                machine={currentMachine}
                state={state}
                onEdit={() => onEditConnectionSettings(currentMachine)}
              />

              <WorkspaceServerCard
                connected={connected}
                loading={workspaceServer.loading}
                state={workspaceServer.state}
                actions={workspaceServer}
              />

              {serverHealthy ? (
                <>
                  <MachineResources metrics={metrics} />
                  <MachineWorkspacesByProject
                    groups={workspaces.data ?? []}
                    loading={workspaces.isLoading}
                    error={workspaces.isError}
                  />
                </>
              ) : (
                <p className="rounded-md border border-dashed border-border px-3 py-8 text-center text-xs text-foreground-passive">
                  Workspace server not connected
                </p>
              )}
            </div>
          )}
        </Sheet.Body>
      </Sheet.Content>
    </Sheet.Root>
  );
});
