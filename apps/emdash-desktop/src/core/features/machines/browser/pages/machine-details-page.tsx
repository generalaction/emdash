import { MachineStatus, McpIcon } from '@emdash/ui/react/components';
import { SettingsCard } from '@emdash/ui/react/patterns';
import {
  Button,
  DropdownMenu,
  Heading,
  Input,
  SelectableCard,
  SeparatedList,
  toast,
} from '@emdash/ui/react/primitives';
import {
  Activity,
  Brain,
  EllipsisIcon,
  Folder,
  MessageSquare,
  PencilIcon,
  Trash2Icon,
  User,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { hostRefFromConnectionId } from '@core/features/agents/api/browser/client';
import { getMachinesClient } from '@core/features/machines/api/browser/client';
import { getMachinesStore } from '@core/features/machines/contributions/app-stores';
import { McpPanel } from '@core/features/mcp/api/browser/components/McpPanel';
import { AgentsPanel } from '@core/features/settings/contributions/browser/agents-page/AgentsPanel';
import { SkillsPanel } from '@core/features/skills/api/browser/components/SkillsPanel';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import type { SettingsPageDetailProps } from '@core/primitives/settings/api/page-contribution';
import { cn } from '@core/primitives/styling/browser/cn';
import { isServerUsable } from '@core/services/hosts/api';
import { MachineConnectionRow } from '../components/machine-connection-card';
import { MachineConversationsList } from '../components/machine-conversations-list';
import { ResourceUtilizationRow } from '../components/machine-resources';
import { deriveMachineStatusKind } from '../components/machine-status-kind';
import { MachineSystemDependenciesCard } from '../components/machine-system-dependencies';
import { WorkspaceRuntimeRow } from '../components/workspace-server-card';
import { WorkspacesListView } from '../components/workspaces-list-view';
import { useHostServerState } from '../use-host-server-state';
import { useMachineMetrics } from '../use-machine-metrics';
import { WorkspaceDetailPage } from './workspace-detail-page';

type MachineDetailsSection =
  | 'system'
  | 'workspaces'
  | 'conversations'
  | 'agents'
  | 'mcp'
  | 'skills';

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

/**
 * Machines tab child detail: path is `[connectionId, projectId]`. Lives here
 * (not in workspace-detail-page.tsx) because it owns the machine
 * connection-state lookup, which core-host boundaries allow for this file.
 */
export const MachineWorkspaceDetailPage = observer(function MachineWorkspaceDetailPage(
  props: SettingsPageDetailProps
) {
  const machineId = props.path[0];
  const machine = getMachinesStore().connections.find((connection) => connection.id === machineId);
  if (!machineId) return null;
  return (
    <WorkspaceDetailPage
      scope={{ kind: 'machine', machineId }}
      connected={machine ? getMachinesStore().stateFor(machine.id) === 'connected' : false}
      machineName={machine?.name}
      {...props}
    />
  );
});

export const MachineDetailsPage = observer(function MachineDetailsPage({
  detailId,
  openDetail,
  closeDetail,
}: SettingsPageDetailProps) {
  const machinesStore = getMachinesStore();
  const machine = machinesStore.connections.find((connection) => connection.id === detailId);
  const openConfirm = useOpenModal('confirmActionModal');
  const openMachineModal = useOpenModal('addSshConnModal');
  const state = machine ? machinesStore.stateFor(machine.id) : 'disconnected';
  const connected = state === 'connected';
  const [name, setName] = useState(machine?.name ?? '');
  const [isRenaming, setIsRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [section, setSection] = useState<MachineDetailsSection>('system');
  const renameFieldRef = useRef<HTMLInputElement>(null);
  const workspaceServer = useHostServerState({
    machineId: machine?.id,
    enabled: !!machine,
    connected,
  });
  const machineStatus = deriveMachineStatusKind({
    connectionState: state,
    workspaceServerStatus: workspaceServer.state?.status,
    workspaceServerError: workspaceServer.state?.error !== undefined,
    workspaceServerLoading: workspaceServer.loading,
  });
  const serverUsable = isServerUsable(workspaceServer.state);
  const metrics = useMachineMetrics(machine?.id, serverUsable);

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
      toast.error('Failed to rename machine', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const connectMachine = async () => {
    try {
      await machinesStore.connect(machine.id);
    } catch (error) {
      toast.error('Failed to connect to machine', { description: String(error) });
    }
  };

  const disconnectMachine = async () => {
    try {
      await machinesStore.disconnect(machine.id);
    } catch (error) {
      toast.error('Failed to disconnect from machine', { description: String(error) });
    }
  };

  const editConnectionSettings = () => {
    void openMachineModal({ dismissControl: 'close', initialConfig: machine });
  };

  const requestDelete = async () => {
    setDeleting(true);
    try {
      const usage = await (await getMachinesClient()).getMachineUsage(undefined);
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
      toast.error('Failed to delete SSH connection', { description: String(error) });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-10">
      <div className="flex min-w-0 items-center gap-2">
        {isRenaming ? (
          <Input
            bare
            ref={renameFieldRef}
            value={name}
            className="min-w-0 flex-1 px-0 text-lg!"
            onChange={(e) => setName(e.target.value)}
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
                size="xs"
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

      <div className="grid grid-cols-6 gap-2">
        <MachineDetailsCard
          icon={<Activity size={14} />}
          title="System"
          selected={section === 'system'}
          onClick={() => setSection('system')}
        />
        <MachineDetailsCard
          icon={<Folder size={14} />}
          title="Workspaces"
          selected={section === 'workspaces'}
          onClick={() => setSection('workspaces')}
        />
        <MachineDetailsCard
          icon={<MessageSquare size={14} />}
          title="Conversations"
          selected={section === 'conversations'}
          onClick={() => setSection('conversations')}
        />
        <MachineDetailsCard
          icon={<User size={14} />}
          title="Agents"
          selected={section === 'agents'}
          onClick={() => setSection('agents')}
        />
        <MachineDetailsCard
          icon={<McpIcon size={14} />}
          title="MCP"
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

      {section === 'system' && (
        <>
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

          {serverUsable ? (
            <MachineSystemDependenciesCard machineId={machine.id} machinesStore={machinesStore} />
          ) : (
            <SettingsCard>
              <div className="p-4 text-sm text-foreground-muted">
                System dependency detection is available when the workspace server is healthy.
              </div>
            </SettingsCard>
          )}
        </>
      )}

      {section === 'workspaces' && (
        <WorkspacesListView
          scope={{ kind: 'machine', machineId: machine.id }}
          openDetail={openDetail}
          enabled={serverUsable}
        />
      )}

      {/* Reads this device's registry cache, so it stays available while the host is offline. */}
      {section === 'conversations' && (
        <MachineConversationsList
          scope={{ kind: 'remote', connectionId: machine.id }}
          hostReachable={connected}
        />
      )}

      {section === 'agents' &&
        (serverUsable ? (
          <AgentsPanel connectionId={machine.id} onManageMcp={() => setSection('mcp')} />
        ) : (
          <SettingsCard>
            <div className="p-4 text-sm text-foreground-muted">
              Agent detection is available when the workspace server is healthy.
            </div>
          </SettingsCard>
        ))}

      {section === 'mcp' &&
        (serverUsable ? (
          <McpPanel host={hostRefFromConnectionId(machine.id)} />
        ) : (
          <SettingsCard>
            <div className="p-4 text-sm text-foreground-muted">
              MCP servers are available when the workspace server is healthy.
            </div>
          </SettingsCard>
        ))}

      {section === 'skills' &&
        (serverUsable ? (
          <SkillsPanel host={hostRefFromConnectionId(machine.id)} />
        ) : (
          <SettingsCard>
            <div className="p-4 text-sm text-foreground-muted">
              Skills are available when the workspace server is healthy.
            </div>
          </SettingsCard>
        ))}
    </div>
  );
});
