import { Button, Sheet } from '@emdash/ui/react/primitives';
import { PlugIcon, SettingsIcon, Trash2Icon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { SshConfig } from '@core/primitives/ssh/api';
import { appState } from '@renderer/lib/stores/app-state';
import { MachineResources } from './components/machine-resources';
import { MachineWorkspacesByProject } from './components/machine-workspaces-by-project';
import { MachineBadge } from './components/MachineBadge';
import { useMachineMetrics } from './use-machine-metrics';
import { useMachineWorkspaces } from './use-machine-workspaces';

export const MachineDetailsSheet = observer(function MachineDetailsSheet({
  open,
  machine,
  deleting = false,
  onOpenChange,
  onConnect,
  onEditConnectionSettings,
  onDelete,
}: {
  open: boolean;
  machine?: SshConfig;
  deleting?: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (machine: SshConfig) => void | Promise<void>;
  onEditConnectionSettings: (machine: SshConfig) => void;
  onDelete?: (machine: SshConfig) => void | Promise<void>;
}) {
  const state = machine ? appState.machines.stateFor(machine.id) : 'disconnected';
  const connecting = state === 'connecting' || state === 'reconnecting';
  const metrics = useMachineMetrics(machine?.id, open);
  const workspaces = useMachineWorkspaces(machine?.id, open);

  return (
    <Sheet.Root open={open} onOpenChange={onOpenChange}>
      <Sheet.Content side="right">
        <Sheet.Header className="[&>div:first-child]:flex-1">
          <div className="flex w-full min-w-0 items-center gap-2">
            <Sheet.Title className="truncate">{machine?.name ?? 'Machine'}</Sheet.Title>
            {machine && (
              <span className="ml-auto shrink-0">
                <MachineBadge state={state} />
              </span>
            )}
          </div>
        </Sheet.Header>
        <Sheet.Body>
          <div className="flex flex-col gap-6 pb-4">
            <MachineResources metrics={metrics} />
            <MachineWorkspacesByProject
              groups={workspaces.data ?? []}
              loading={workspaces.isLoading}
              error={workspaces.isError}
            />
          </div>
        </Sheet.Body>
        <Sheet.Footer>
          {machine && onDelete && (
            <Button
              type="button"
              variant="ghost"
              tone="destructive"
              disabled={deleting}
              onClick={() => void onDelete(machine)}
            >
              <Trash2Icon />
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          )}
          {machine && state !== 'connected' && (
            <Button
              type="button"
              variant="secondary"
              disabled={connecting}
              onClick={() => void onConnect(machine)}
            >
              <PlugIcon />
              {connecting ? 'Connecting…' : 'Connect'}
            </Button>
          )}
          <Button
            type="button"
            variant="primary"
            disabled={!machine}
            onClick={() => machine && onEditConnectionSettings(machine)}
          >
            <SettingsIcon />
            Edit Connection Settings
          </Button>
        </Sheet.Footer>
      </Sheet.Content>
    </Sheet.Root>
  );
});
