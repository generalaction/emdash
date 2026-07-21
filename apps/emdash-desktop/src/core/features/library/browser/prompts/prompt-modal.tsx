import { useMemo, useState } from 'react';
import { useModalController } from '@core/manifests/browser/modal-api';
import { defineModal } from '@core/primitives/modals/react';
import type { PromptLibraryPrompt } from '@core/primitives/prompt-library/api';
import { Button } from '@core/primitives/ui/browser/button';
import { ConfirmButton } from '@core/primitives/ui/browser/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@core/primitives/ui/browser/dialog';
import { Field, FieldGroup, FieldLabel } from '@core/primitives/ui/browser/field';
import { Input } from '@core/primitives/ui/browser/input';
import { Textarea } from '@core/primitives/ui/browser/textarea';

export type PromptFormResult = Pick<PromptLibraryPrompt, 'title' | 'prompt'>;

type PromptModalArgs = {
  initialPrompt?: PromptLibraryPrompt | PromptFormResult;
};

type Props = PromptModalArgs;

export function PromptModal({ initialPrompt }: Props) {
  const { complete, dismiss } = useModalController('promptModal');
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
    complete({ title: normalizedTitle, prompt: normalizedPrompt });
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
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={dismiss}>
          Cancel
        </Button>
        <ConfirmButton onClick={handleSave} disabled={!canSave}>
          Save
        </ConfirmButton>
      </DialogFooter>
    </>
  );
}

export const promptModal = defineModal<PromptFormResult>()({
  id: 'promptModal',
  component: PromptModal,
  size: 'lg',
});
