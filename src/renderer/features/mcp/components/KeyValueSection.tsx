import { X } from 'lucide-react';
import React from 'react';
import { parseEnvAssignmentPaste, replaceEnvEntryWithPaste } from '@renderer/lib/env-paste';
import { Button } from '@renderer/lib/ui/button';
import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';

export interface KVEntry {
  id: number;
  key: string;
  value: string;
}

interface KeyValueSectionProps {
  label: string;
  entries: KVEntry[];
  onChange: (entries: KVEntry[]) => void;
  addLabel: string;
  makeId: () => number;
  credentialKeys: Map<string, boolean>;
  splitEnvPaste?: boolean;
}

export const KeyValueSection: React.FC<KeyValueSectionProps> = ({
  label,
  entries,
  onChange,
  addLabel,
  makeId,
  credentialKeys,
  splitEnvPaste = false,
}) => {
  const handlePaste = (index: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    if (!splitEnvPaste) return;

    const pasted = parseEnvAssignmentPaste(e.clipboardData.getData('text'));
    if (pasted.length === 0) return;

    e.preventDefault();
    const pastedEntries = pasted.map((entry, pastedIndex) => ({
      id: pastedIndex === 0 ? entries[index].id : makeId(),
      key: entry.key,
      value: entry.value,
    }));
    onChange(replaceEnvEntryWithPaste(entries, index, pastedEntries));
  };

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="space-y-2">
        {entries.map((entry, i) => {
          const isCredential = credentialKeys.has(entry.key);
          const isRequired = credentialKeys.get(entry.key) === true;
          return (
            <div key={entry.id} className="flex items-center gap-2">
              <Input
                value={entry.key}
                onChange={(e) => {
                  const next = [...entries];
                  next[i] = { ...entry, key: e.target.value };
                  onChange(next);
                }}
                className="h-8 w-1/2"
                placeholder="KEY"
                onPaste={(e) => handlePaste(i, e)}
              />
              <Input
                value={entry.value}
                onChange={(e) => {
                  const next = [...entries];
                  next[i] = { ...entry, value: e.target.value };
                  onChange(next);
                }}
                className={`h-8 w-1/2 ${
                  isCredential && isRequired && !entry.value
                    ? 'border-border-warning bg-background-warning'
                    : ''
                }`}
                placeholder={isCredential ? (isRequired ? 'Required' : 'Optional') : 'value'}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive size-8 shrink-0"
                onClick={() => onChange(entries.filter((_, j) => j !== i))}
              >
                <X className="size-3" />
              </Button>
            </div>
          );
        })}
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={() => onChange([...entries, { id: makeId(), key: '', value: '' }])}
        >
          {addLabel}
        </Button>
      </div>
    </Field>
  );
};
