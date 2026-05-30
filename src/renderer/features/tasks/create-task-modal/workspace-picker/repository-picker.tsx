import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { ChevronDown, FolderGit2, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { cn } from '@renderer/utils/utils';
import { buildPickerItems } from './workspace-picker-items';
import { PickerRepoRowContent } from './workspace-picker-rows';
import { PickerSearchInput, WorkspacePickerList } from './workspace-picker-list';
import { useWorkspacePickerData } from './use-workspace-picker-data';

interface RepositoryPickerProps {
  projectId: string;
  value: string | null;
  onChange: (instanceId: string | null) => void;
}

export function RepositoryPicker({ projectId, value, onChange }: RepositoryPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const data = useWorkspacePickerData(projectId);
  const showAddRepoModal = useShowModal('addRepoInstanceModal');

  const items = buildPickerItems(data, { search, includeWorktrees: false });

  // Find the selected repo item to render in the trigger
  const allRepoItems = items.filter((i) => i.type === 'repo' && i.instance.id === value);
  const selectedRepoItem = allRepoItems[0]?.type === 'repo' ? allRepoItems[0] : undefined;

  const handleSelect = (instanceId: string) => {
    onChange(instanceId);
    setOpen(false);
    setSearch('');
  };

  const triggerContent = selectedRepoItem ? (
    <PickerRepoRowContent item={selectedRepoItem} />
  ) : (
    <div className="flex h-9 items-center gap-2 px-2.5 text-sm text-foreground-passive">
      <FolderGit2 absoluteStrokeWidth strokeWidth={1.5} className="size-3.5 shrink-0" />
      <span>Select a repository…</span>
      <div className="flex-1" />
      <ChevronDown absoluteStrokeWidth strokeWidth={2} className="size-3.5 shrink-0" />
    </div>
  );

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <div className="group relative">
        <PopoverPrimitive.Trigger
          className={cn(
            'flex w-full min-w-0 rounded-md border border-border bg-background text-left outline-none',
            'hover:bg-background-1 data-popup-open:bg-background-1',
            selectedRepoItem ? 'pr-8' : ''
          )}
          render={<button type="button" />}
        >
          {triggerContent}
        </PopoverPrimitive.Trigger>
        {value && (
          <button
            type="button"
            aria-label="Clear selection"
            onClick={() => onChange(null)}
            className="absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-foreground-muted opacity-0 hover:bg-background-2 hover:text-foreground group-hover:opacity-100"
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
              placeholder="Search repositories…"
            />

            <div className="max-h-72 overflow-y-auto py-1">
              <WorkspacePickerList
                items={items}
                mode="repo"
                selectedValue={value}
                onSelect={handleSelect}
              />
            </div>

            {/* Footer: add repository */}
            <div className="border-t border-border px-1.5 py-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  showAddRepoModal({ projectId });
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-foreground-muted hover:bg-background-1 hover:text-foreground"
              >
                <Plus absoluteStrokeWidth strokeWidth={2} className="size-3.5 shrink-0" />
                Add repository
              </button>
            </div>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

