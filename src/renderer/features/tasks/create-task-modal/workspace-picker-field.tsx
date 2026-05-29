import { Combobox as ComboboxPrimitive } from '@base-ui/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, FolderGit2, GitBranch } from 'lucide-react';
import { useCallback, useRef } from 'react';
import { Combobox, ComboboxContent, ComboboxInput } from '@renderer/lib/ui/combobox';
import { cn } from '@renderer/utils/utils';
import type { WorktreeEntry } from '@shared/workspaces';

const PICKER_ITEM_HEIGHT = 44;
const MAX_LIST_HEIGHT = 208; // ~13rem

function getItemLabel(entry: WorktreeEntry | null): string {
  if (!entry) return '';
  const label = entry.isMain ? 'Main repository' : (entry.branch ?? 'detached HEAD');
  return `${label} ${entry.path}`;
}

interface WorkspacePickerFieldProps {
  value: WorktreeEntry | null;
  onValueChange: (entry: WorktreeEntry | null) => void;
  worktrees: WorktreeEntry[] | undefined;
  isPending: boolean;
}

export function WorkspacePickerField({
  value,
  onValueChange,
  worktrees,
  isPending,
}: WorkspacePickerFieldProps) {
  const items = worktrees ?? [];

  const triggerLabel = value
    ? value.isMain
      ? 'Main repository'
      : (value.branch ?? 'detached HEAD')
    : null;

  return (
    <Combobox
      value={value}
      onValueChange={(v) => onValueChange(v)}
      items={items}
      itemToStringLabel={getItemLabel}
      isItemEqualToValue={(a, b) => !!a && !!b && a.path === b.path}
      virtualized
    >
      <ComboboxPrimitive.Trigger
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md border border-border px-2.5 py-2 text-sm outline-none',
          'hover:bg-background-1 data-popup-open:bg-background-1'
        )}
      >
        {triggerLabel ? (
          <div className="flex min-w-0 items-center gap-1.5 text-left">
            {value?.isMain ? (
              <FolderGit2
                absoluteStrokeWidth
                strokeWidth={1.5}
                className="size-3.5 shrink-0 text-foreground-muted"
              />
            ) : (
              <GitBranch
                absoluteStrokeWidth
                strokeWidth={2}
                className="size-3.5 shrink-0 text-foreground-muted"
              />
            )}
            <span className="truncate font-medium text-foreground">{triggerLabel}</span>
            <span className="truncate font-mono text-xs text-foreground-passive" title={value?.path}>
              {value?.path}
            </span>
          </div>
        ) : (
          <span className="text-foreground-muted">Select a workspace…</span>
        )}
        <ChevronDown className="size-4 shrink-0 text-foreground-muted" />
      </ComboboxPrimitive.Trigger>

      <ComboboxContent className="border">
        <ComboboxInput showTrigger={false} placeholder="Search workspaces…" />

        {isPending ? (
          <p className="px-2 py-3 text-center text-sm text-foreground-muted">Loading…</p>
        ) : (
          <ComboboxPrimitive.List className="p-0">
            <VirtualizedList />
          </ComboboxPrimitive.List>
        )}
      </ComboboxContent>
    </Combobox>
  );
}

function VirtualizedList() {
  const filteredItems = ComboboxPrimitive.useFilteredItems<WorktreeEntry>();
  const scrollElementRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: filteredItems.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => PICKER_ITEM_HEIGHT,
    overscan: 5,
  });

  const handleScrollRef = useCallback(
    (element: HTMLDivElement | null) => {
      scrollElementRef.current = element;
      if (element) {
        virtualizer.measure();
      }
    },
    [virtualizer]
  );

  if (!filteredItems.length) {
    return (
      <p className="px-2 py-3 text-center text-sm text-foreground-muted">No workspaces found</p>
    );
  }

  return (
    <div
      ref={handleScrollRef}
      className="overflow-y-auto"
      style={{ height: Math.min(filteredItems.length * PICKER_ITEM_HEIGHT, MAX_LIST_HEIGHT) }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vItem) => {
          const entry = filteredItems[vItem.index]!;
          const isMain = entry.isMain;
          const label = isMain ? 'Main repository' : (entry.branch ?? 'detached HEAD');

          return (
            <ComboboxPrimitive.Item
              key={vItem.key}
              value={entry}
              index={vItem.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vItem.start}px)`,
                height: PICKER_ITEM_HEIGHT,
              }}
              className={cn(
                'flex cursor-default items-center gap-2 px-2 py-1.5 text-sm outline-none select-none',
                'not-data-selected:data-highlighted:bg-background-quaternary-1',
                'data-selected:bg-background-quaternary-2'
              )}
            >
              {isMain ? (
                <FolderGit2
                  absoluteStrokeWidth
                  strokeWidth={1.5}
                  className="size-4 shrink-0 text-foreground-muted"
                />
              ) : (
                <GitBranch
                  absoluteStrokeWidth
                  strokeWidth={2}
                  className="size-4 shrink-0 text-foreground-muted"
                />
              )}
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm text-foreground">{label}</span>
                <span
                  className="truncate font-mono text-xs text-foreground-passive"
                  title={entry.path}
                >
                  {entry.path}
                </span>
              </div>
              <ComboboxPrimitive.ItemIndicator className="ml-auto flex size-4 shrink-0 items-center justify-center" />
            </ComboboxPrimitive.Item>
          );
        })}
      </div>
    </div>
  );
}
