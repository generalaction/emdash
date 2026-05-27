import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { conversationRegistry } from '@renderer/features/tasks/stores/conversation-registry';
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

type RenameConversationModalArgs = {
  projectId: string;
  taskId: string;
  conversationId: string;
  currentName: string;
};

type Props = BaseModalProps<void> & RenameConversationModalArgs;

export const RenameConversationModal = observer(function RenameConversationModal({
  taskId,
  conversationId,
  currentName,
  onSuccess,
  onClose,
}: Props) {
  const [name, setName] = useState(currentName);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const isUnchanged = trimmed === currentName.trim();
  const isEmpty = trimmed.length === 0;
  const isValid = !isEmpty && !isUnchanged;

  const handleSubmit = useCallback(async () => {
    if (!isValid) return;
    const conversations = conversationRegistry.get(taskId);
    if (!conversations) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await conversations.renameConversation(conversationId, trimmed);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename conversation');
      setIsSubmitting(false);
    }
  }, [isValid, taskId, conversationId, trimmed, onSuccess]);

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>Rename conversation</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <FieldGroup>
          <Field>
            <FieldLabel>Name</FieldLabel>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSubmit();
              }}
              maxLength={128}
              autoFocus
            />
            {isEmpty && <p className="mt-1 text-xs text-destructive">Name cannot be empty.</p>}
            {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
          </Field>
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <ConfirmButton onClick={() => void handleSubmit()} disabled={!isValid || isSubmitting}>
          {isSubmitting ? 'Renaming…' : 'Rename'}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
