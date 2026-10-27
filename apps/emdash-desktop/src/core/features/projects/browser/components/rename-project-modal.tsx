import { Button, Dialog, Field, Input } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { getProjectManagerStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { useModalController } from '@core/manifests/browser/modal-api';
import { ConfirmButton } from '@core/primitives/keybindings/browser/confirm-button';
import { defineModal } from '@core/primitives/modals/react';

type RenameProjectModalArgs = {
  projectId: string;
  currentName: string;
};

export const RenameProjectModal = observer(function RenameProjectModal({
  projectId,
  currentName,
}: RenameProjectModalArgs) {
  const { complete, dismiss } = useModalController('renameProjectModal');
  const [name, setName] = useState(currentName);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const isEmpty = trimmedName.length === 0;
  const isUnchanged = trimmedName === currentName;
  const isValid = !isEmpty && !isUnchanged;

  const handleSubmit = useCallback(async () => {
    if (!isValid || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await getProjectManagerStore().renameProject(projectId, trimmedName);
      complete();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename project');
      setIsSubmitting(false);
    }
  }, [isValid, isSubmitting, projectId, trimmedName, complete]);

  return (
    <>
      <Dialog.Header showCloseButton={false}>
        <Dialog.Title>Rename project</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body className="pt-0">
        <Field.Group>
          <Field.Root>
            <Field.Label>Project name</Field.Label>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSubmit();
              }}
              autoFocus
            />
            {isEmpty && (
              <p className="text-destructive mt-1 text-xs">Project name cannot be empty.</p>
            )}
            {error && <p className="text-destructive mt-1 text-xs">{error}</p>}
          </Field.Root>
        </Field.Group>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onClick={dismiss}>
          Cancel
        </Button>
        <ConfirmButton
          variant="primary"
          onClick={() => void handleSubmit()}
          disabled={!isValid || isSubmitting}
        >
          {isSubmitting ? 'Renaming...' : 'Rename'}
        </ConfirmButton>
      </Dialog.Footer>
    </>
  );
});

export const renameProjectModal = defineModal<void>()({
  id: 'renameProjectModal',
  component: RenameProjectModal,
  size: 'xs',
});
