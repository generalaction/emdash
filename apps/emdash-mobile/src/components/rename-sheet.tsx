import { Button, Input } from '@emdash/ui/react';
import { useEffect, useState, type FormEvent } from 'react';
import { useMobileClient } from '../client/context';
import type { ResourceSummary } from '../client/types';
import { validateResourceTitle } from '../model';
import { BottomSheet } from './bottom-sheet';

export function RenameSheet({
  resource,
  onClose,
  onRenamed,
}: {
  resource?: ResourceSummary;
  onClose: () => void;
  onRenamed: (resource: ResourceSummary) => void;
}) {
  const client = useMobileClient();
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(resource?.title ?? '');
    setError('');
  }, [resource]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!resource) return;
    const validation = validateResourceTitle(title);
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    try {
      const next = await client.renameResource(resource.id, title.trim());
      onRenamed(next);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not rename this session.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet open={Boolean(resource)} title="Rename session" onClose={onClose}>
      <form className="rename-form" onSubmit={save}>
        <label htmlFor="resource-title">Name</label>
        <Input
          id="resource-title"
          value={title}
          autoFocus
          maxLength={100}
          onChange={(event) => {
            setTitle(event.target.value);
            setError('');
          }}
        />
        <div className="field-meta">
          {error ? (
            <span className="form-error" role="alert">
              {error}
            </span>
          ) : (
            <span>Shown on both your phone and desktop.</span>
          )}
          <span>{title.length}/100</span>
        </div>
        <Button
          type="submit"
          variant="primary"
          className="primary-action"
          disabled={saving || Boolean(validateResourceTitle(title))}
        >
          {saving ? <span className="spinner" /> : null}
          {saving ? 'Saving…' : 'Save name'}
        </Button>
      </form>
    </BottomSheet>
  );
}
