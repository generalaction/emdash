import { useMemo, useState } from 'react';
import type { AppSettings } from '@shared/app-settings';
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
import { Textarea } from '@renderer/lib/ui/textarea';

export type PromptLibraryPrompt = AppSettings['promptLibrary'][number];
export type PromptFormResult = Pick<PromptLibraryPrompt, 'title' | 'prompt'>;

type PromptModalArgs = {
  initialPrompt?: PromptLibraryPrompt | PromptFormResult;
};

type Props = BaseModalProps<PromptFormResult> & PromptModalArgs;

export function PromptModal({ initialPrompt, onSuccess, onClose }: Props) {
  const initialForm = useMemo<PromptFormResult>(
    () => ({
      title: initialPrompt?.title ?? '',
      prompt: initialPrompt?.prompt ?? '',
    }),
    [initialPrompt]
  );
  const [form, setForm] = useState(initialForm);

  const normalizedTitle = form.title.trim();
  const normalizedPrompt = form.prompt.trim();
  const canSave = normalizedTitle.length > 0 && normalizedPrompt.length > 0;

  const handleSave = () => {
    if (!canSave) return;
    onSuccess({ title: normalizedTitle, prompt: normalizedPrompt });
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
              className="min-h-56 resize-y px-3 py-2.5 text-[14px] leading-relaxed"
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
