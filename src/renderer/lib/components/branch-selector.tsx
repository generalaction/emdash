import { GitBranch } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { Branch } from '@shared/git';
import { Badge } from '@renderer/lib/ui/badge';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '@renderer/lib/ui/combobox';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';

interface BranchSelectorProps {
  branches: Branch[];
  value?: Branch;
  onValueChange: (value: Branch) => void;
  remoteOnly?: boolean;
  trigger?: React.ReactNode;
}

export function BranchSelector({
  branches,
  value,
  onValueChange,
  remoteOnly = false,
  trigger,
}: BranchSelectorProps) {
  const [tab, setTab] = useState<'local' | 'remote'>(remoteOnly ? 'remote' : 'local');
  const inputRef = React.useRef<HTMLInputElement>(null);

  const localCount = useMemo(() => branches.filter((b) => b.type === 'local').length, [branches]);
  const remoteCount = useMemo(() => branches.filter((b) => b.type === 'remote').length, [branches]);

  const filteredBranches = useMemo(() => branches.filter((b) => b.type === tab), [branches, tab]);

  const options = useMemo(
    () => filteredBranches.map((branch) => ({ value: branch, label: branch.branch })),
    [filteredBranches]
  );

  return (
    <Combobox
      items={options}
      autoHighlight
      value={value ? { value: value, label: value.branch } : undefined}
      onValueChange={(v) => v !== null && onValueChange(v.value)}
      isItemEqualToValue={(a, b) =>
        a.value.type === b.value.type && a.value.branch === b.value.branch
      }
    >
      {trigger ?? (
        <ComboboxTrigger className="border flex border-border h-9 hover:bg-muted/30 rounded-md px-2.5 py-1 text-left text-sm outline-none items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground">
            <GitBranch />
            <ComboboxValue placeholder="Select a branch" />
          </div>
        </ComboboxTrigger>
      )}
      <ComboboxContent className="min-w-(--anchor-width) pb-1">
        <ToggleGroup
          value={[tab]}
          onValueChange={([value]) => {
            if (value) {
              setTab(value as 'local' | 'remote');
              inputRef.current?.focus();
            }
          }}
          className="w-full border-0 border-b border-border rounded-b-none"
        >
          <ToggleGroupItem
            value="local"
            className="group flex-1 flex items-center gap-1"
            disabled={remoteOnly || localCount === 0}
          >
            Local
            <Badge
              variant="secondary"
              className="shrink-0 bg-background-2 transition-colors group-data-pressed:bg-background-3"
            >
              {localCount}
            </Badge>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="remote"
            className="group flex-1 flex items-center gap-1"
            disabled={remoteOnly || remoteCount === 0}
          >
            Remote
            <Badge
              variant="secondary"
              className="shrink-0 bg-background-2 transition-colors group-data-pressed:bg-background-3"
            >
              {remoteCount}
            </Badge>
          </ToggleGroupItem>
        </ToggleGroup>
        <ComboboxInput showTrigger={false} placeholder="Search branches" inputRef={inputRef} />
        <ComboboxList>
          {(item) => (
            <ComboboxItem value={item} disabled={item.label.startsWith('_reserve')}>
              {item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
        <ComboboxEmpty>{branches.length === 0 ? 'no branches exist' : 'no results'}</ComboboxEmpty>
      </ComboboxContent>
    </Combobox>
  );
}
