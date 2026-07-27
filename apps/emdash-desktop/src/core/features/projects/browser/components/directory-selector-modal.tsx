import { useState } from 'react';
import { useModalController } from '@core/manifests/browser/modal-api';
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
import { Input } from '@core/primitives/ui/browser/input';
import { ModalLayout } from '@core/primitives/ui/browser/modal-layout';
import {
  ProjectDirectoryPicker,
  type ProjectDirectoryPickerClient,
} from './add-project-modal/project-directory-picker';

export interface DirectorySelectorModalProps {
  connectionId: string;
  initialPath?: string;
  getProjectsClient(): Promise<ProjectDirectoryPickerClient>;
}

export function DirectorySelectorModal({
  connectionId,
  initialPath = '',
  getProjectsClient,
}: DirectorySelectorModalProps) {
  const modal = useModalController('directorySelectorModal');
  const [selectedPath, setSelectedPath] = useState(initialPath);
  const canSelect = selectedPath.trim().length > 0;

  return (
    <ModalLayout
      header={
        <DialogHeader>
          <DialogTitle>Select Remote Directory</DialogTitle>
        </DialogHeader>
      }
      footer={
        <DialogFooter>
          <Button variant="outline" onClick={modal.dismiss}>
            Cancel
          </Button>
          <ConfirmButton
            type="button"
            disabled={!canSelect}
            onClick={() => modal.complete({ path: selectedPath })}
          >
            Select
          </ConfirmButton>
        </DialogFooter>
      }
    >
      <DialogContentArea data-autofocus tabIndex={-1} className="gap-4">
        <ProjectDirectoryPicker
          strategy="ssh"
          connectionId={connectionId}
          value={selectedPath}
          getProjectsClient={getProjectsClient}
          onSelect={setSelectedPath}
        />
        <Field>
          <FieldLabel>Path</FieldLabel>
          <Input
            value={selectedPath}
            placeholder="/home/user/project"
            spellCheck={false}
            onChange={(event) => setSelectedPath(event.target.value)}
          />
        </Field>
      </DialogContentArea>
    </ModalLayout>
  );
}

export const directorySelectorModal = defineModal<{ path: string }>()({
  id: 'directorySelectorModal',
  component: DirectorySelectorModal,
  size: 'lg',
});
