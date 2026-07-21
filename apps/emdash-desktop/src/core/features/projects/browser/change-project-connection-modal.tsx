import { useState } from 'react';
import { getProjectManagerStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { SshConnectionSelector } from '@core/features/projects/browser/components/add-project-modal/ssh-connection-selector';
import { useModalController, useOpenModal } from '@core/manifests/browser/modal-api';
import { defineModal } from '@core/primitives/modals/react';
import { Button } from '@core/primitives/ui/browser/button';
import { ConfirmButton } from '@core/primitives/ui/browser/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@core/primitives/ui/browser/dialog';
import { Field, FieldLabel } from '@core/primitives/ui/browser/field';
import { ModalLayout } from '@core/primitives/ui/browser/modal-layout';
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
  const openChangeConnectionModal = useOpenModal('changeProjectConnectionModal');

  const reopenParent = (connectionId: string) => {
    void openChangeConnectionModal({
      projectId,
      currentConnectionId: connectionId,
    });
  };

  const handleAddConnection = async () => {
    const priorConnectionId = selectedConnectionId;
    const outcome = await openSshConnModal({});
    if (outcome.success) {
      reopenParent(outcome.data.connectionId);
    } else if (outcome.error.reason === 'explicit') {
      reopenParent(priorConnectionId);
    }
  };

  const handleEditConnection = async (id: string) => {
    const conn = appState.machines.connections.find((c) => c.id === id);
    if (!conn) return;
    const priorConnectionId = selectedConnectionId;
    const outcome = await openSshConnModal({
      initialConfig: conn,
    });
    if (outcome.success) {
      reopenParent(outcome.data.connectionId);
    } else if (outcome.error.reason === 'explicit') {
      reopenParent(priorConnectionId);
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
        <DialogHeader>
          <DialogTitle>Change SSH Connection</DialogTitle>
        </DialogHeader>
      }
      footer={
        <DialogFooter>
          <Button variant="outline" onClick={modal.dismiss} disabled={isSaving}>
            Cancel
          </Button>
          <ConfirmButton
            onClick={() => void handleSave()}
            disabled={isSaving || !selectedConnectionId}
          >
            {isSaving ? 'Saving…' : 'Save'}
          </ConfirmButton>
        </DialogFooter>
      }
    >
      <DialogContentArea>
        <Field>
          <FieldLabel>SSH Connection</FieldLabel>
          <SshConnectionSelector
            connectionId={selectedConnectionId}
            onConnectionIdChange={setSelectedConnectionId}
            onAddConnection={() => void handleAddConnection()}
            onEditConnection={(id) => void handleEditConnection(id)}
          />
        </Field>
      </DialogContentArea>
    </ModalLayout>
  );
}

export const changeProjectConnectionModal = defineModal<void>()({
  id: 'changeProjectConnectionModal',
  component: ChangeProjectConnectionModal,
  size: 'sm',
});
