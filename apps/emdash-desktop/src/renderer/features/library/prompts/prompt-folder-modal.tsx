import { useState } from 'react';
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

type PromptFolderModalArgs = {
  initialName?: string;
  existingNames?: string[];
};

type Props = BaseModalProps<string> & PromptFolderModalArgs;

export function PromptFolderModal({ initialName, existingNames = [], onSuccess, onClose }: Props) {
  const [name, setName] = useState(initialName ?? '');

  const normalizedName = name.trim();
  const isDuplicate =
    normalizedName.toLowerCase() !== (initialName ?? '').trim().toLowerCase() &&
    existingNames.some(
      (existing) => existing.trim().toLowerCase() === normalizedName.toLowerCase()
    );
  const canSave = normalizedName.length > 0 && !isDuplicate;

  const handleSave = () => {
    if (!canSave) return;
    onSuccess(normalizedName);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{initialName ? 'Rename Folder' : 'New Folder'}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <FieldGroup>
          <Field>
            <FieldLabel>Name</FieldLabel>
            <Input
              data-autofocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
              }}
              placeholder="Reviews"
            />
            {isDuplicate && (
              <p className="text-destructive mt-1 text-xs">
                A folder with this name already exists.
              </p>
            )}
          </Field>
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <ConfirmButton onClick={handleSave} disabled={!canSave}>
          {initialName ? 'Rename' : 'Create'}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
}
