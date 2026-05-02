import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { MAX_PROJECT_NAME_LENGTH } from '@shared/projects';
import { getProjectManagerStore } from '@renderer/features/projects/stores/project-selectors';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';

type RenameProjectModalArgs = {
  projectId: string;
  currentName: string;
};

type Props = BaseModalProps<void> & RenameProjectModalArgs;

export const RenameProjectModal = observer(function RenameProjectModal({
  projectId,
  currentName,
  onSuccess,
  onClose,
}: Props) {
  const [name, setName] = useState(currentName);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const isUnchanged = trimmedName === currentName;
  const isEmpty = trimmedName.length === 0;
  const isValid = !isEmpty && !isUnchanged;

  const validationMessage = isEmpty ? 'Project name cannot be empty.' : undefined;

  const handleSubmit = useCallback(async () => {
    if (!isValid) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await getProjectManagerStore().renameProject(projectId, trimmedName);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename project');
      setIsSubmitting(false);
    }
  }, [isValid, projectId, trimmedName, onSuccess]);

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>Rename project</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <FieldGroup>
          <Field>
            <FieldLabel>Project name</FieldLabel>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSubmit();
              }}
              maxLength={MAX_PROJECT_NAME_LENGTH}
              autoFocus
            />
            {validationMessage && !isUnchanged && (
              <p className="text-xs text-destructive mt-1">{validationMessage}</p>
            )}
            {error && <p className="text-xs text-destructive mt-1">{error}</p>}
          </Field>
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <ConfirmButton onClick={() => void handleSubmit()} disabled={!isValid || isSubmitting}>
          {isSubmitting ? 'Renaming...' : 'Rename'}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
