import { Search } from 'lucide-react';
import { type ChangeEvent } from 'react';
import { cn } from '@renderer/utils/utils';
import type { PickerItem } from './workspace-picker-items';
import {
  PickerHostRow,
  PickerRepoRow,
  PickerWorktreeRow,
} from './workspace-picker-rows';

// ---------------------------------------------------------------------------
// PickerSearchInput
// ---------------------------------------------------------------------------

export function PickerSearchInput({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative flex h-9 shrink-0 items-center border-b border-border px-2.5">
      <Search className="pointer-events-none absolute left-2.5 size-3.5 shrink-0 text-foreground-muted" />
      <input
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full bg-transparent pl-6 text-sm outline-none placeholder:text-foreground-passive"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkspacePickerList
// ---------------------------------------------------------------------------

export function WorkspacePickerList({
  items,
  mode,
  selectedValue,
  onSelect,
}: {
  items: PickerItem[];
  mode: 'repo' | 'worktree';
  selectedValue: string | null;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="relative overflow-y-auto" role="listbox">
      {items.map((item, i) => {
        if (item.type === 'host') {
          return (
            <div
              key={`host-${item.hostKey}`}
              className={cn(
                'sticky top-0 z-20 bg-background-quaternary',
                i > 0 && 'border-t border-border'
              )}
            >
              <PickerHostRow item={item} />
            </div>
          );
        }

        if (item.type === 'repo') {
          if (mode === 'repo') {
            const isSelected = selectedValue === item.instance.id;
            return (
              <div key={`repo-${item.instance.id}`} className="px-1.5 py-0.5">
                <PickerRepoRow
                  item={item}
                  isSelected={isSelected}
                  selectable
                  onClick={() => onSelect(item.instance.id)}
                />
              </div>
            );
          }

          // mode === 'worktree': repo rows are selectable via mainEntry path
          const mainPath = item.mainEntry?.path ?? '';
          const isSelected = !!mainPath && selectedValue === mainPath;
          return (
            <div key={`repo-${item.instance.id}`} className="px-1.5 py-0.5">
              <PickerRepoRow
                item={item}
                isSelected={isSelected}
                selectable={!!mainPath}
                onClick={() => mainPath && onSelect(mainPath)}
              />
            </div>
          );
        }

        // worktree item — only shown / selectable in worktree mode
        const isSelected = selectedValue === item.entry.path;
        return (
          <div key={`wt-${item.entry.path}`} className="px-1.5 py-0.5">
            <PickerWorktreeRow
              item={item}
              isSelected={isSelected}
              onClick={() => onSelect(item.entry.path)}
            />
          </div>
        );
      })}
    </div>
  );
}
