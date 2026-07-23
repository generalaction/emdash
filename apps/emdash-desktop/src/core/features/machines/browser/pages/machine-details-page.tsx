import { MachineStatus } from '@emdash/ui/react/components';
import { SettingsCard } from '@emdash/ui/react/patterns';
import { Button, DropdownMenu, Heading, SeparatedList } from '@emdash/ui/react/primitives';
import { SelectableCard } from '@emdash/ui/react/primitives';
import { Brain, EllipsisIcon, Folder, PencilIcon, Server, Trash2Icon, User } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import type { SettingsPageDetailProps } from '@core/primitives/settings/api/page-contribution';
import { cn } from '@core/primitives/ui/browser/cn';
import { EditableNameField } from '@core/primitives/ui/browser/editable-name-field';
import { toast } from '@core/primitives/ui/browser/use-toast';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { appState } from '@renderer/lib/stores/app-state';
import { MachineConnectionRow } from '../components/machine-connection-card';
import { ResourceUtilizationRow } from '../components/machine-resources';
import { deriveMachineStatusKind } from '../components/machine-status-kind';
import { MachineWorkspacesList } from '../components/machine-workspaces-list';
import { WorkspaceRuntimeRow } from '../components/workspace-server-card';
import { useMachineMetrics } from '../use-machine-metrics';
import { useRemoteMachineServerState } from '../use-remote-machine-server-state';

type MachineDetailsSection = 'workspaces' | 'agents' | 'mcp' | 'skills';

function MachineDetailsCard({
  children,
  icon,
  title,
  selected,
  onClick,
}: {
  children?: React.ReactNode;
  icon: React.ReactNode;
  title: string | React.ReactNode;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <SelectableCard
      padding="2"
      borderRadius="md"
      className="flex-1"
      selected={selected}
      onClick={onClick}
    >
      <span className="flex w-full items-center justify-center gap-2">
        {icon}
        <span className="text-sm">{title}</span>
      </span>
      {children}
    </SelectableCard>
  );
}

export const MachineDetailsPage = observer(function MachineDetailsPage({
  detailId,
  closeDetail,
}: SettingsPageDetailProps) {
  const machinesStore = appState.machines;
  const machine = machinesStore.connections.find((connection) => connection.id === detailId);
  const openConfirm = useOpenModal('confirmActionModal');
  const openMachineModal = useOpenModal('addSshConnModal');
  const state = machine ? machinesStore.stateFor(machine.id) : 'disconnected';
  const connected = state === 'connected';
  const [name, setName] = useState(machine?.name ?? '');
  const [isRenaming, setIsRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [section, setSection] = useState<MachineDetailsSection>('workspaces');
  const renameFieldRef = useRef<HTMLInputElement>(null);
  const workspaceServer = useRemoteMachineServerState({
    machineId: machine?.id,
    enabled: !!machine,
    connected,
  });
  const machineStatus = deriveMachineStatusKind({
    connectionState: state,
    workspaceServerStatus: workspaceServer.state?.status,
    workspaceServerLoading: workspaceServer.loading,
  });
  const serverHealthy = workspaceServer.state?.status === 'healthy';
  const metrics = useMachineMetrics(machine?.id, serverHealthy);

  useEffect(() => {
    setName(machine?.name ?? '');
  }, [machine?.id, machine?.name]);

  useEffect(() => {
    if (isRenaming) {
      renameFieldRef.current?.focus();
      renameFieldRef.current?.select();
    }
  }, [isRenaming]);

  if (!machine) return null;

  const commitName = async (value: string) => {
    const nextName = value.trim();
    if (!nextName || nextName === machine.name) {
      setName(machine.name);
      setIsRenaming(false);
      return;
    }

    try {
      await machinesStore.renameConnection(machine.id, nextName);
      setIsRenaming(false);
    } catch (error) {
      setName(machine.name);
      toast({
        title: 'Failed to rename machine',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const connectMachine = async () => {
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

  const disconnectMachine = async () => {
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

  const editConnectionSettings = () => {
    void openMachineModal({ dismissControl: 'close', initialConfig: machine });
  };

  const requestDelete = async () => {
    setDeleting(true);
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
      closeDetail();
    } catch (error) {
      toast({
        title: 'Failed to delete SSH connection',
        description: String(error),
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-10">
      <div className="flex min-w-0 items-center gap-2">
        {isRenaming ? (
          <EditableNameField
            ref={renameFieldRef}
            value={name}
            className="min-w-0 flex-1"
            onChange={setName}
            onBlur={(event) => void commitName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                event.currentTarget.value = machine.name;
                setName(machine.name);
                setIsRenaming(false);
              }
            }}
          />
        ) : (
          <div className="flex items-center gap-2">
            <MachineStatus size="2rem" status={machineStatus} />
            <Heading level={1} tone="default">
              {machine.name}
            </Heading>
          </div>
        )}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            render={
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon
                aria-label="Machine actions"
                className="ml-auto"
              />
            }
          >
            <EllipsisIcon />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            <DropdownMenu.Item onClick={() => setIsRenaming(true)} disabled={isRenaming}>
              <PencilIcon />
              Rename
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              variant="destructive"
              disabled={deleting}
              onClick={() => void requestDelete()}
            >
              <Trash2Icon />
              {deleting ? 'Deleting…' : 'Delete'}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>

      <SettingsCard>
        <SeparatedList gap="1rem" direction="column">
          <MachineConnectionRow
            machine={machine}
            state={state}
            onEdit={editConnectionSettings}
            onConnect={connectMachine}
            onDisconnect={disconnectMachine}
          />
          <div
            aria-disabled={!connected}
            className={cn(!connected && 'pointer-events-none opacity-33')}
          >
            <WorkspaceRuntimeRow
              connected={connected}
              loading={workspaceServer.loading}
              state={workspaceServer.state}
              actions={workspaceServer}
            />
          </div>
          <div
            aria-disabled={!connected}
            className={cn(!connected && 'pointer-events-none opacity-33')}
          >
            <ResourceUtilizationRow metrics={metrics} />
          </div>
        </SeparatedList>
      </SettingsCard>

      <div className="grid grid-cols-4 gap-2">
        <MachineDetailsCard
          icon={<Folder size={14} />}
          title="Workspaces"
          selected={section === 'workspaces'}
          onClick={() => setSection('workspaces')}
        />
        <MachineDetailsCard
          icon={<User size={14} />}
          title="Agents"
          selected={section === 'agents'}
          onClick={() => setSection('agents')}
        />
        <MachineDetailsCard
          icon={<Server size={14} />}
          title="MCP Servers"
          selected={section === 'mcp'}
          onClick={() => setSection('mcp')}
        />
        <MachineDetailsCard
          icon={<Brain size={14} />}
          title="Skills"
          selected={section === 'skills'}
          onClick={() => setSection('skills')}
        />
      </div>

      {section === 'workspaces' && (
        <MachineWorkspacesList
          machineId={machine.id}
          connectionId={machine.id}
          enabled={serverHealthy}
        />
      )}
    </div>
  );
});
