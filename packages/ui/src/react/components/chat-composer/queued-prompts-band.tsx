import { Button } from '@react/primitives/button';
import { cx } from '@styles/utilities/cx';
import { ArrowDown, ArrowUp, Check, ListChecks, Pencil, SendHorizontal, X } from 'lucide-react';
import * as React from 'react';
import * as styles from './queued-prompts-band.css';

export type ComposerQueuedPrompt = {
  id: string;
  text: string;
};

export interface QueuedPromptsBandProps {
  prompts: ComposerQueuedPrompt[];
  onEdit: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onSendNow: (id: string) => void;
  className?: string;
}

export function QueuedPromptsBand({
  prompts,
  onEdit,
  onDelete,
  onReorder,
  onSendNow,
  className,
}: QueuedPromptsBandProps) {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');

  React.useEffect(() => {
    if (!editingId) return;
    if (prompts.some((prompt) => prompt.id === editingId)) return;
    setEditingId(null);
    setDraft('');
  }, [editingId, prompts]);

  const ids = prompts.map((prompt) => prompt.id);

  const beginEdit = (prompt: ComposerQueuedPrompt) => {
    setEditingId(prompt.id);
    setDraft(prompt.text);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft('');
  };

  const saveEdit = (id: string) => {
    const next = draft.trim();
    if (!next) return;
    onEdit(id, draft);
    cancelEdit();
  };

  const move = (id: string, direction: -1 | 1) => {
    const index = ids.indexOf(id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return;
    const next = [...ids];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    onReorder(next);
  };

  if (prompts.length === 0) return null;

  return (
    <div className={cx(styles.band, className)}>
      <div className={styles.header}>
        <ListChecks className={styles.headerIcon} aria-hidden />
        <span>
          <span className={styles.headerStrong}>Queued prompts</span> ({prompts.length})
        </span>
      </div>

      <div className={styles.list}>
        {prompts.map((prompt, index) => {
          const isEditing = editingId === prompt.id;
          return (
            <div key={prompt.id} className={styles.row}>
              <span className={styles.index}>{index + 1}</span>

              {isEditing ? (
                <div className={styles.editArea}>
                  <textarea
                    className={styles.editInput}
                    value={draft}
                    rows={2}
                    aria-label={`Edit queued prompt ${index + 1}`}
                    onChange={(event) => setDraft(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        cancelEdit();
                      }
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        saveEdit(prompt.id);
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon
                    aria-label="Save queued prompt"
                    title="Save queued prompt"
                    disabled={!draft.trim()}
                    onClick={() => saveEdit(prompt.id)}
                  >
                    <Check />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon
                    aria-label="Cancel edit"
                    title="Cancel edit"
                    onClick={cancelEdit}
                  >
                    <X />
                  </Button>
                </div>
              ) : (
                <span className={cx(styles.promptText, !prompt.text.trim() && styles.emptyText)}>
                  {prompt.text.trim() || 'Image-only prompt'}
                </span>
              )}

              {!isEditing && (
                <div className={styles.actions}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon
                    aria-label="Send queued prompt now"
                    title="Send now - cancels the active turn"
                    onClick={() => onSendNow(prompt.id)}
                  >
                    <SendHorizontal />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon
                    aria-label="Edit queued prompt"
                    title="Edit queued prompt"
                    onClick={() => beginEdit(prompt)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon
                    aria-label="Move queued prompt up"
                    title="Move up"
                    disabled={index === 0}
                    onClick={() => move(prompt.id, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon
                    aria-label="Move queued prompt down"
                    title="Move down"
                    disabled={index === prompts.length - 1}
                    onClick={() => move(prompt.id, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon
                    aria-label="Delete queued prompt"
                    title="Delete queued prompt"
                    onClick={() => onDelete(prompt.id)}
                  >
                    <X />
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
