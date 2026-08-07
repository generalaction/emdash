import {
  ComboboxPopover,
  MachineStatus,
  type MachineStatusKind,
} from '@emdash/ui/react/components';
import {
  Button,
  Button as UiButton,
  Dialog,
  Field,
  ModalLayout,
} from '@emdash/ui/react/primitives';
import { PencilIcon, PlusIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { deriveConnectionMachineStatusKind } from '@core/features/machines/api/browser/machine-status-kind';
import { getProjectManagerStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { useModalController, useOpenModal } from '@core/manifests/browser/modal-api';
import { ConfirmButton } from '@core/primitives/keybindings/browser/confirm-button';
import { defineModal } from '@core/primitives/modals/react';
import type { SshConfig } from '@core/primitives/ssh/api';
import { appState } from '@renderer/lib/stores/app-state';

export interface ChangeProjectConnectionModalProps {
  projectId: string;
  currentConnectionId: string;
}

export function ChangeProjectConnectionModal({
  projectId,
  currentConnectionId,
}: ChangeProjectConnectionModalProps) {
  const modal = useModalController('changeProjectConnectionModal');
  const [selectedConnectionId, setSelectedConnectionId] = useState(currentConnectionId);
  const [isSaving, setIsSaving] = useState(false);

  const openSshConnModal = useOpenModal('addSshConnModal');

  const handleAddConnection = async () => {
    const outcome = await openSshConnModal({});
    if (outcome.success) {
      setSelectedConnectionId(outcome.data.connectionId);
    }
  };

  const handleEditConnection = async (id: string) => {
    const conn = appState.machines.connections.find((c) => c.id === id);
    if (!conn) return;
    const outcome = await openSshConnModal({
      initialConfig: conn,
    });
    if (outcome.success) {
      setSelectedConnectionId(outcome.data.connectionId);
    }
  };

  const handleSave = async () => {
    if (selectedConnectionId === currentConnectionId) {
      modal.dismiss();
      return;
    }
    setIsSaving(true);
    try {
      await getProjectManagerStore()?.updateProjectConnection(projectId, selectedConnectionId);
      modal.complete();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ModalLayout
      header={
        <Dialog.Header>
          <Dialog.Title>Change SSH Connection</Dialog.Title>
        </Dialog.Header>
      }
      footer={
        <Dialog.Footer>
          <Button variant="secondary" onClick={modal.dismiss} disabled={isSaving}>
            Cancel
          </Button>
          <ConfirmButton
            variant="primary"
            onClick={() => void handleSave()}
            disabled={isSaving || !selectedConnectionId}
          >
            {isSaving ? 'Saving…' : 'Save'}
          </ConfirmButton>
        </Dialog.Footer>
      }
    >
      <Dialog.Body>
        <Field.Root>
          <Field.Label>SSH Connection</Field.Label>
          <ChangeConnectionSelector
            connectionId={selectedConnectionId}
            onConnectionIdChange={setSelectedConnectionId}
            onAddConnection={() => void handleAddConnection()}
            onEditConnection={(id) => void handleEditConnection(id)}
          />
        </Field.Root>
      </Dialog.Body>
    </ModalLayout>
  );
}

type MachineOption = SshConfig & { id: string };

const ChangeConnectionSelector = observer(function ChangeConnectionSelector({
  connectionId,
  onConnectionIdChange,
  onAddConnection,
  onEditConnection,
}: {
  connectionId: string;
  onConnectionIdChange: (connectionId: string) => void;
  onAddConnection: () => void;
  onEditConnection?: (connectionId: string) => void;
}) {
  const machines = appState.machines.connections.filter(
    (machine): machine is MachineOption => machine.id !== undefined
  );

  return (
    <ComboboxPopover
      items={machines}
      value={connectionId}
      onValueChange={onConnectionIdChange}
      itemToKey={(machine) => machine.id}
      itemToLabel={(machine) => machine.name}
      renderTrigger={(machine) => (
        <MachineConnectionLabel
          machine={machine}
          status={getMachineStatusKind(machine?.id)}
          placeholder="Select a connection"
        />
      )}
      triggerTitle={(machine) => machine?.name ?? 'Select a connection'}
      renderItem={(machine) => (
        <MachineConnectionLabel machine={machine} status={getMachineStatusKind(machine.id)} />
      )}
      renderFooter={() => (
        <div className="flex gap-1 p-1">
          <UiButton
            type="button"
            variant="ghost"
            size="sm"
            tone="neutral"
            className="flex-1 justify-start"
            onClick={onAddConnection}
          >
            <PlusIcon className="size-4" />
            Add
          </UiButton>
          {connectionId && onEditConnection ? (
            <UiButton
              type="button"
              variant="ghost"
              size="sm"
              tone="neutral"
              className="flex-1 justify-start"
              onClick={() => onEditConnection(connectionId)}
            >
              <PencilIcon className="size-4" />
              Edit
            </UiButton>
          ) : null}
        </div>
      )}
      searchPlaceholder="Search connections..."
      appearance="input"
      className="w-full"
    />
  );
});

function getMachineStatusKind(machineId: string | undefined) {
  if (!machineId) return 'idle';
  return deriveConnectionMachineStatusKind(appState.machines.stateFor(machineId));
}

function MachineConnectionLabel({
  machine,
  status,
  placeholder,
}: {
  machine: MachineOption | null;
  status: MachineStatusKind;
  placeholder?: string;
}) {
  if (!machine) {
    return <span className="text-foreground-muted">{placeholder ?? 'Unknown connection'}</span>;
  }

  return (
    <span className="flex min-w-0 items-center gap-2">
      <MachineStatus status={status} size="1rem" />
      <span className="min-w-0 truncate">{machine.name}</span>
    </span>
  );
}

export const changeProjectConnectionModal = defineModal<void>()({
  id: 'changeProjectConnectionModal',
  component: ChangeProjectConnectionModal,
  size: 'sm',
});
