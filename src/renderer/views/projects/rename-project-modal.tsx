import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import { ConfirmButton } from '@renderer/components/ui/confirm-button';
import {
  DialogContent,
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/components/ui/field';
import { Input } from '@renderer/components/ui/input';
import { BaseModalProps } from '@renderer/core/modal/modal-provider';
import { projectManagerStore } from '@renderer/core/stores/project-manager';
import { getProjectStore } from '@renderer/core/stores/project-selectors';

const MAX_PROJECT_NAME_LENGTH = 128;

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

  const siblingNames = new Set(
    Array.from(projectManagerStore.projects.values())
      .filter((p) => p.id !== projectId && p.state !== 'unregistered')
      .map((p) => p.data!.name)
  );

  const trimmedName = name.trim();
  const isDuplicate = siblingNames.has(trimmedName);
  const isUnchanged = trimmedName === currentName;
  const isEmpty = trimmedName.length === 0;
  const isValid = !isEmpty && !isDuplicate && !isUnchanged;

  const validationMessage = isDuplicate
    ? 'A project with this name already exists.'
    : isEmpty
      ? 'Project name cannot be empty.'
      : undefined;

  const handleSubmit = useCallback(async () => {
    if (!isValid) return;
    const project = getProjectStore(projectId);
    if (!project) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await project.rename(trimmedName);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename project');
      setIsSubmitting(false);
    }
  }, [isValid, projectId, trimmedName, onSuccess]);

  return (
    <DialogContent showCloseButton={false} className="sm:max-w-xs">
      <DialogHeader>
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
    </DialogContent>
  );
});
