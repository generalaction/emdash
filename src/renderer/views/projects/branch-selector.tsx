import { GitBranch } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { Branch } from '@shared/git';
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '@renderer/components/ui/combobox';
import { cn } from '@renderer/lib/utils';

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
        <div className="flex  p-1">
          <button
            className={cn(
              'px-3 py-1 text-sm font-normal rounded-md disabled:opacity-50',
              tab === 'local' && 'bg-muted font-medium '
            )}
            onMouseDown={(e) => {
              e.preventDefault();
              setTab('local');
            }}
            disabled={remoteOnly || localCount === 0}
          >
            Local ({localCount})
          </button>
          <button
            className={cn(
              'px-3 py-1 text-sm font-normal rounded-md disabled:opacity-50',
              tab === 'remote' && 'bg-muted font-medium '
            )}
            onMouseDown={(e) => {
              e.preventDefault();
              setTab('remote');
            }}
            disabled={remoteOnly || remoteCount === 0}
          >
            Remote ({remoteCount})
          </button>
        </div>
        <ComboboxInput showTrigger={false} placeholder="Search branches" />
        <ComboboxList>
          {(item) => <ComboboxItem value={item}>{item.label}</ComboboxItem>}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
