import { useMemo, useState } from 'react';
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
import type { PromptLibraryFolder } from '@shared/prompt-library';

export type FolderFormResult = Pick<PromptLibraryFolder, 'title'>;

type FolderModalArgs = {
  initialFolder?: PromptLibraryFolder | FolderFormResult;
};

type Props = BaseModalProps<FolderFormResult> & FolderModalArgs;

export function FolderModal({ initialFolder, onSuccess, onClose }: Props) {
  const initialForm = useMemo<FolderFormResult>(
    () => ({
      title: initialFolder?.title ?? '',
    }),
    [initialFolder]
  );
  const [form, setForm] = useState(initialForm);

  const normalizedTitle = form.title.trim();
  const canSave = normalizedTitle.length > 0;

  const handleSave = () => {
    if (!canSave) return;
    onSuccess({ title: normalizedTitle });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{initialFolder ? 'Edit Folder' : 'New Folder'}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="gap-4 pt-0">
        <FieldGroup>
          <Field>
            <FieldLabel>Name</FieldLabel>
            <Input
              data-autofocus
              value={form.title}
              onChange={(e) => setForm({ title: e.target.value })}
              placeholder="Reviews"
            />
          </Field>
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <ConfirmButton onClick={handleSave} disabled={!canSave}>
          Save
        </ConfirmButton>
      </DialogFooter>
    </>
  );
}
