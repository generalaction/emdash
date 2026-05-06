import { X } from 'lucide-react';
import React from 'react';
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
}

export const KeyValueSection: React.FC<KeyValueSectionProps> = ({
  label,
  entries,
  onChange,
  addLabel,
  makeId,
  credentialKeys,
}) => {
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
                    ? 'border-amber-400/60 bg-amber-50/10'
                    : ''
                }`}
                placeholder={isCredential ? (isRequired ? 'Required' : 'Optional') : 'value'}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => onChange(entries.filter((_, j) => j !== i))}
              >
                <X className="h-3 w-3" />
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
