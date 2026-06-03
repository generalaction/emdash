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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Textarea } from '@renderer/lib/ui/textarea';
import type { PromptLibraryFolder, PromptLibraryPrompt } from '@shared/prompt-library';

const NO_FOLDER_VALUE = '__no_folder__';

export type PromptFormResult = Pick<PromptLibraryPrompt, 'title' | 'prompt' | 'folderId'>;

type PromptModalArgs = {
  initialPrompt?: PromptLibraryPrompt | PromptFormResult;
  folders?: PromptLibraryFolder[];
};

type Props = BaseModalProps<PromptFormResult> & PromptModalArgs;

export function PromptModal({ initialPrompt, folders = [], onSuccess, onClose }: Props) {
  const initialForm = useMemo<PromptFormResult>(
    () => ({
      title: initialPrompt?.title ?? '',
      prompt: initialPrompt?.prompt ?? '',
      folderId: initialPrompt?.folderId,
    }),
    [initialPrompt]
  );
  const [form, setForm] = useState(initialForm);

  const normalizedTitle = form.title.trim();
  const normalizedPrompt = form.prompt.trim();
  const canSave = normalizedTitle.length > 0 && normalizedPrompt.length > 0;

  const handleSave = () => {
    if (!canSave) return;
    onSuccess({
      title: normalizedTitle,
      prompt: normalizedPrompt,
      folderId: form.folderId,
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{initialPrompt ? 'Edit Prompt' : 'New Prompt'}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="gap-4 pt-0">
        <FieldGroup>
          <Field>
            <FieldLabel>Title</FieldLabel>
            <Input
              data-autofocus
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="Security review"
            />
          </Field>
          <Field>
            <FieldLabel>Prompt</FieldLabel>
            <Textarea
              value={form.prompt}
              onChange={(e) => setForm((prev) => ({ ...prev, prompt: e.target.value }))}
              placeholder="Write the prompt agents should receive."
              className="max-h-[50dvh] min-h-56 resize-y overflow-y-auto px-3 py-2.5 text-[14px] leading-relaxed"
            />
          </Field>
          {folders.length > 0 && (
            <Field>
              <FieldLabel>Folder</FieldLabel>
              <Select
                value={form.folderId ?? NO_FOLDER_VALUE}
                onValueChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    folderId:
                      typeof value === 'string' && value !== NO_FOLDER_VALUE ? value : undefined,
                  }))
                }
              >
                <SelectTrigger className="h-9 w-full bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_FOLDER_VALUE}>No folder</SelectItem>
                  {folders.map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {folder.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
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
