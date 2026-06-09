import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { getProjectManagerStore } from '@renderer/features/projects/stores/project-selectors';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
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
import { MAX_PROJECT_NAME_LENGTH } from '@shared/projects';

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
  const projectManager = getProjectManagerStore();

  const normalizedName = name.trim();
  const isEmpty = normalizedName.length === 0;
  const isTooLong = normalizedName.length > MAX_PROJECT_NAME_LENGTH;
  const isUnchanged = normalizedName === currentName;
  const isValid = !isEmpty && !isTooLong && !isUnchanged;

  const validationMessage = isEmpty
    ? 'Project name cannot be empty.'
    : isTooLong
      ? `Project name must be ${MAX_PROJECT_NAME_LENGTH} characters or fewer.`
      : isUnchanged
        ? 'Enter a different name to rename the project.'
        : undefined;

  const handleSubmit = useCallback(async () => {
    if (!isValid) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await projectManager.renameProject(projectId, normalizedName);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename project');
      setIsSubmitting(false);
    }
  }, [isValid, normalizedName, onSuccess, projectId, projectManager]);

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
            {validationMessage && (
              <p className="text-destructive mt-1 text-xs">{validationMessage}</p>
            )}
            {error && <p className="text-destructive mt-1 text-xs">{error}</p>}
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
