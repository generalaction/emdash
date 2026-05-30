import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { ChevronDown, X } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { cn } from '@renderer/utils/utils';
import type { WorktreeEntry } from '@shared/workspaces';
import { buildPickerItems, type PickerRepoItem, type PickerWorktreeItem } from './workspace-picker-items';
import {
  PickerRepoRowContent,
  PickerWorktreeRowContent,
} from './workspace-picker-rows';
import { PickerSearchInput, WorkspacePickerList } from './workspace-picker-list';
import { useWorkspacePickerData } from './use-workspace-picker-data';

// ---------------------------------------------------------------------------
// Selection context passed to renderSelection
// ---------------------------------------------------------------------------

export type WorkspacePickerSelectionContext =
  | { kind: 'repo'; item: PickerRepoItem }
  | { kind: 'worktree'; item: PickerWorktreeItem };

// ---------------------------------------------------------------------------
// Factored-out trigger content component
// ---------------------------------------------------------------------------

export function WorkspacePickerTriggerContent({
  selectedRepoItem,
  selectedWorktreeItem,
  renderSelection,
  renderPlaceholder,
}: {
  selectedRepoItem: PickerRepoItem | undefined;
  selectedWorktreeItem: PickerWorktreeItem | undefined;
  renderSelection?: (ctx: WorkspacePickerSelectionContext) => ReactNode;
  renderPlaceholder?: () => ReactNode;
}) {
  if (selectedRepoItem?.type === 'repo') {
    const ctx: WorkspacePickerSelectionContext = { kind: 'repo', item: selectedRepoItem };
    return renderSelection ? <>{renderSelection(ctx)}</> : <PickerRepoRowContent item={selectedRepoItem} className="hover:bg-background-2 transition-colors px-3 bg-background-2" />;
  }
  if (selectedWorktreeItem?.type === 'worktree') {
    const ctx: WorkspacePickerSelectionContext = { kind: 'worktree', item: selectedWorktreeItem };
    return renderSelection ? <>{renderSelection(ctx)}</> : <PickerWorktreeRowContent item={selectedWorktreeItem} className="hover:bg-background-2 transition-colors px-3 bg-background-2" />;
  }
  if (renderPlaceholder) return <>{renderPlaceholder()}</>;
  return (
    <div className="flex items-center gap-2 px-2.5 h-full justify-center text-sm text-foreground-passive hover:bg-background-2 transition-colors">
      <span>Select a workspace</span>
      <ChevronDown className="size-3.5 shrink-0" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkspacePicker
// ---------------------------------------------------------------------------

interface WorkspacePickerProps {
  projectId: string;
  value: WorktreeEntry | null;
  onChange: (entry: WorktreeEntry | null) => void;
  renderSelection?: (ctx: WorkspacePickerSelectionContext) => ReactNode;
  renderPlaceholder?: () => ReactNode;
}

export function WorkspacePicker({ projectId, value, onChange, renderSelection, renderPlaceholder }: WorkspacePickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const data = useWorkspacePickerData(projectId);

  const items = useMemo(
    () => buildPickerItems(data, { search, includeWorktrees: true }),
    [data, search]
  );

  // All selectable entries: repo items (via mainEntry) + worktree items
  const allRepoItems = useMemo(() => items.filter((i) => i.type === 'repo'), [items]);
  const allWorktreeItems = useMemo(() => items.filter((i) => i.type === 'worktree'), [items]);

  // Selected value for the list = the path of the selected entry
  const selectedPath = value?.path ?? null;

  const handleSelect = (path: string) => {
    // First search linked worktrees
    const worktreeMatch = allWorktreeItems.find(
      (i) => i.type === 'worktree' && i.entry.path === path
    );
    if (worktreeMatch?.type === 'worktree') {
      onChange(worktreeMatch.entry);
      setOpen(false);
      setSearch('');
      return;
    }
    // Then search repo items via mainEntry path
    const repoMatch = allRepoItems.find(
      (i) => i.type === 'repo' && i.mainEntry?.path === path
    );
    if (repoMatch?.type === 'repo' && repoMatch.mainEntry) {
      onChange(repoMatch.mainEntry);
      setOpen(false);
      setSearch('');
    }
  };

  const selectedRepoItem = value?.isMain
    ? allRepoItems.find((i) => i.type === 'repo' && i.mainEntry?.path === value.path)
    : undefined;
  const selectedWorktreeItem =
    !value?.isMain && value
      ? allWorktreeItems.find((i) => i.type === 'worktree' && i.entry.path === value.path)
      : undefined;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <div className="group relative">
        <PopoverPrimitive.Trigger
          className="w-full h-14"
          render={<button type="button" />}
        >
          <WorkspacePickerTriggerContent
            selectedRepoItem={selectedRepoItem?.type === 'repo' ? selectedRepoItem : undefined}
            selectedWorktreeItem={selectedWorktreeItem?.type === 'worktree' ? selectedWorktreeItem : undefined}
            renderSelection={renderSelection}
            renderPlaceholder={renderPlaceholder}
          />
        </PopoverPrimitive.Trigger>
        {value && (
          <button
            type="button"
            aria-label="Clear selection"
            onClick={() => onChange(null)}
            className="absolute  bg-background/50 border right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-foreground-muted opacity-0 hover:bg-background-2 hover:text-foreground group-hover:opacity-100"
          >
            <X absoluteStrokeWidth strokeWidth={2} className="size-3.5" />
          </button>
        )}
      </div>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          side="bottom"
          align="start"
          sideOffset={4}
          className="isolate z-50"
        >
          <PopoverPrimitive.Popup
            className={cn(
              'flex w-(--anchor-width) min-w-48 flex-col overflow-hidden rounded-md bg-background-quaternary text-sm text-foreground shadow-md ring-1 ring-foreground/10 outline-hidden',
              'origin-(--transform-origin) duration-100 data-[side=bottom]:slide-in-from-top-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95'
            )}
          >
            <PickerSearchInput
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search workspaces…"
            />

            <WorkspacePickerList
              items={items}
              mode="worktree"
              selectedValue={selectedPath}
              onSelect={handleSelect}
            />
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
