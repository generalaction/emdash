import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronRight,
  Folder,
  FolderInput,
  FolderMinus,
  FolderPlus,
  Minus,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { MultiLineListItem } from '@renderer/lib/components/multi-line-list-item';
import { PageHeader } from '@renderer/lib/components/page-header';
import { toast } from '@renderer/lib/hooks/use-toast';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { SearchInput } from '@renderer/lib/ui/search-input';
import { cn } from '@renderer/utils/utils';
import type { PromptLibraryFolder, PromptLibraryPrompt } from '@shared/prompt-library';
import type { PromptFormResult } from './prompt-modal';
import { usePromptLibrary } from './use-prompt-library';

type PromptListItem = {
  id: string;
  title: string;
  prompt: string;
};

type PromptSection = {
  folder: PromptLibraryFolder | null;
  prompts: PromptLibraryPrompt[];
};

// Marks whole-section drop zones so drag handlers can tell a section drop
// apart from a row target; folderId null means the ungrouped section.
type FolderZoneData = {
  type: 'folder-zone';
  folderId: string | null;
};

function getFolderZoneData(data: Record<string, unknown> | undefined): FolderZoneData | null {
  return data?.type === 'folder-zone' ? (data as FolderZoneData) : null;
}

function createId(prefix: string) {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}`;
}

function withFolderId(
  prompt: PromptLibraryPrompt,
  folderId: string | undefined
): PromptLibraryPrompt {
  if (!folderId) {
    const { folderId: _folderId, ...rest } = prompt;
    return rest;
  }
  return { ...prompt, folderId };
}

// Prompt rows win over the section zones that contain them; section zones
// catch the pointer everywhere else (headers, padding, empty areas). Without
// the row-first pass, pointerWithin can flip between a row and its enclosing
// zone depending on which center is closer.
const collisionDetection: CollisionDetection = (args) => {
  const rowContainers = args.droppableContainers.filter(
    (container) => !getFolderZoneData(container.data.current)
  );
  const rowHits = pointerWithin({ ...args, droppableContainers: rowContainers });
  if (rowHits.length > 0) return rowHits;
  const zoneHits = pointerWithin(args);
  if (zoneHits.length > 0) return zoneHits;
  return closestCenter({ ...args, droppableContainers: rowContainers });
};

function matchesSearch(item: PromptListItem, search: string) {
  if (!search) return true;
  const haystack = `${item.title} ${item.prompt}`.toLowerCase();
  return haystack.includes(search.toLowerCase());
}

function buildSections(
  prompts: PromptLibraryPrompt[],
  folders: PromptLibraryFolder[]
): PromptSection[] {
  const folderIds = new Set(folders.map((folder) => folder.id));
  return [
    ...folders.map((folder) => ({
      folder,
      prompts: prompts.filter((prompt) => prompt.folderId === folder.id),
    })),
    {
      folder: null,
      prompts: prompts.filter((prompt) => !prompt.folderId || !folderIds.has(prompt.folderId)),
    },
  ];
}

function PromptRow({
  item,
  disabled,
  onEdit,
  onDelete,
}: {
  item: PromptListItem;
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex w-full">
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={onEdit}
        disabled={disabled}
      >
        <div className="text-md truncate text-foreground">{item.title}</div>
        <div className="mt-1 line-clamp-1 text-xs leading-relaxed text-foreground-muted">
          {item.prompt}
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onEdit}
          disabled={disabled}
          aria-label={`Edit ${item.title}`}
        >
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onDelete}
          disabled={disabled}
          aria-label={`Delete ${item.title}`}
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}

function SortablePromptItem({
  id,
  isLast,
  canDrag,
  children,
}: {
  id: string;
  isLast: boolean;
  canDrag: boolean;
  children: React.ReactNode;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !canDrag,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className="relative"
      {...listeners}
    >
      {/* While dragging, the in-list item becomes a drop slot: the row (and its
          divider) is hidden and a subtle fill marks where it would land. */}
      <div className={cn(isDragging && 'invisible')}>
        <MultiLineListItem isLast={isLast} className="py-3">
          {children}
        </MultiLineListItem>
      </div>
      {isDragging && <div className="absolute inset-x-0 inset-y-1 rounded-lg bg-background-1" />}
    </div>
  );
}

function FolderSectionHeader({
  folder,
  count,
  collapsed,
  isDragActive,
  isDropTarget,
  disabled,
  onToggle,
  onRename,
  onDelete,
}: {
  folder: PromptLibraryFolder;
  count: number;
  collapsed: boolean;
  isDragActive: boolean;
  isDropTarget: boolean;
  disabled: boolean;
  onToggle: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        'group flex items-center gap-1 rounded-lg px-3 py-2 transition-colors',
        isDropTarget && 'bg-background-1'
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={`Toggle ${folder.name}`}
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-foreground-muted transition-transform',
            !collapsed && 'rotate-90'
          )}
        />
        <Folder className="size-3.5 shrink-0 text-foreground-muted" />
        <span className="truncate text-sm font-medium text-foreground">{folder.name}</span>
        <span className="shrink-0 text-xs text-foreground-muted">{count}</span>
      </button>
      {/* Hidden (not unmounted) during drags: unmounting shrinks the header
          and makes the whole list shift at drag start. */}
      <div
        className={cn(
          'flex shrink-0 items-center gap-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100',
          isDragActive && 'invisible'
        )}
      >
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onRename}
          disabled={disabled}
          aria-label={`Rename ${folder.name}`}
        >
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onDelete}
          disabled={disabled}
          aria-label={`Delete ${folder.name}`}
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}

// Makes a whole section (folder header + prompt list, or the ungrouped list)
// a drop target, so prompts can be dropped anywhere inside it rather than
// only on the folder header.
function PromptSectionZone({
  zoneId,
  folderId,
  disabled,
  children,
}: {
  zoneId: string;
  folderId: string | null;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({
    id: zoneId,
    data: { type: 'folder-zone', folderId } satisfies FolderZoneData,
    disabled,
  });

  return (
    <div ref={setNodeRef} className="flex flex-col">
      {children}
    </div>
  );
}

// Rendered inside the DragOverlay so the dragged prompt follows the pointer
// as a floating card, like the sidebar's drag ghost. The badge mirrors Finder:
// (+) while the drop would move the prompt into a folder, (−) while it would
// move it out.
function PromptDragGhost({
  prompt,
  badge,
}: {
  prompt: PromptLibraryPrompt;
  badge: 'add' | 'remove' | null;
}) {
  return (
    // A plain single-surface card, deliberately not MultiLineListItem: its
    // outer padding and hover background paint bands along the top and bottom
    // edges (the pointer always hovers the ghost). No drop shadow either — on
    // a card this wide the blur reads as smudges along the long edges.
    <div className="relative flex items-start rounded-lg bg-background-tertiary-2 p-3 ring-1 ring-border">
      <PromptRow item={prompt} disabled onEdit={() => {}} onDelete={() => {}} />
      {badge && (
        <div className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background shadow-sm">
          {badge === 'add' ? <Plus className="size-3.5" /> : <Minus className="size-3.5" />}
        </div>
      )}
    </div>
  );
}

export function PromptLibraryView() {
  const {
    prompts: promptLibraryPrompts,
    folders,
    update: updatePromptLibrary,
    reorder: reorderPromptLibrary,
    isLoading: isPromptLibraryLoading,
    isSaving: isPromptLibrarySaving,
  } = usePromptLibrary();
  const showPromptModal = useShowModal('promptModal');
  const showFolderModal = useShowModal('promptFolderModal');
  const showConfirm = useShowModal('confirmActionModal');
  const [search, setSearch] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<ReadonlySet<string>>(new Set());
  // Applied synchronously in onDragEnd so the new order commits in the same
  // render as dnd-kit's drop-state reset. Query updates arrive on a later
  // tick, which would paint the old order for a frame and make items jump.
  const [pendingOrder, setPendingOrder] = useState<PromptLibraryPrompt[] | null>(null);
  // Live preview while dragging: onDragOver moves the dragged prompt between
  // sections here so it visibly slots into the hovered folder (the standard
  // dnd-kit multi-container pattern). Committed or discarded on drop.
  const [draftPrompts, setDraftPrompts] = useState<PromptLibraryPrompt[] | null>(null);
  const [dragState, setDragState] = useState<{
    id: string;
    originFolderId: string | undefined;
  } | null>(null);
  // Folders spring-opened by hovering during a drag; collapsed again on drop
  // unless they end up as the destination.
  const autoExpandedFoldersRef = useRef<Set<string>>(new Set());

  const promptLibrary = pendingOrder ?? promptLibraryPrompts;
  const viewPrompts = draftPrompts ?? promptLibrary;
  const isDisabled = isPromptLibraryLoading || isPromptLibrarySaving;

  const trimmedSearch = search.trim();
  const isSearching = trimmedSearch.length > 0;

  const folderIds = useMemo(() => new Set(folders.map((folder) => folder.id)), [folders]);
  const normalizeFolderId = (folderId: string | undefined) =>
    folderId && folderIds.has(folderId) ? folderId : undefined;

  const sections = useMemo(() => buildSections(viewPrompts, folders), [viewPrompts, folders]);
  // The grouped display order; reorders are computed on (and saved in) this
  // order so the stored array stays grouped and prompt menus mirror the view.
  const displayPrompts = useMemo(() => sections.flatMap((section) => section.prompts), [sections]);

  const visibleSections = useMemo(() => {
    if (!isSearching) return sections;
    return sections
      .map((section) => ({
        ...section,
        prompts: section.prompts.filter((item) => matchesSearch(item, trimmedSearch)),
      }))
      .filter((section) => section.prompts.length > 0);
  }, [sections, isSearching, trimmedSearch]);

  const hasVisibleContent = visibleSections.some(
    (section) => section.folder !== null || section.prompts.length > 0
  );

  // Dragging within a filtered subset is ambiguous, so it requires the full list.
  // Reorders persist full snapshots, so only allow one save in flight.
  const canDragPrompts = !isDisabled && !isSearching && promptLibrary.length > 0;

  const activeDragPrompt = dragState
    ? viewPrompts.find((item) => item.id === dragState.id)
    : undefined;
  // Where the prompt currently sits in the drag preview vs. where it started;
  // drives the ghost badge and the destination folder's header highlight.
  const currentDragFolderId = activeDragPrompt
    ? normalizeFolderId(activeDragPrompt.folderId)
    : undefined;
  const dragFolderChanged =
    dragState !== null &&
    activeDragPrompt !== undefined &&
    currentDragFolderId !== dragState.originFolderId;
  const ghostBadge: 'add' | 'remove' | null = !dragFolderChanged
    ? null
    : currentDragFolderId
      ? 'add'
      : 'remove';

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const upsertPrompt = (prompt: PromptLibraryPrompt, successTitle: string) => {
    const exists = promptLibrary.some((item) => item.id === prompt.id);
    const nextPrompts = exists
      ? promptLibrary.map((item) => (item.id === prompt.id ? prompt : item))
      : [...promptLibrary, prompt];
    updatePromptLibrary(
      { prompts: nextPrompts, folders },
      {
        onSuccess: () => toast({ title: successTitle }),
      }
    );
  };

  const createPrompt = () => {
    showPromptModal({
      folders,
      onSuccess: (result: PromptFormResult) => {
        upsertPrompt({ id: createId('prompt'), ...result }, 'Prompt added');
      },
    });
  };

  const editPrompt = (prompt: PromptLibraryPrompt) => {
    showPromptModal({
      initialPrompt: prompt,
      folders,
      onSuccess: (result: PromptFormResult) =>
        upsertPrompt({ ...prompt, ...result }, 'Prompt updated'),
    });
  };

  const deletePrompt = (prompt: PromptLibraryPrompt) => {
    showConfirm({
      title: 'Delete prompt?',
      description: `"${prompt.title}" will be removed from the prompt library.`,
      confirmLabel: 'Delete',
      onSuccess: () =>
        updatePromptLibrary(
          {
            prompts: promptLibrary.filter((item) => item.id !== prompt.id),
            folders,
          },
          {
            onSuccess: () => toast({ title: 'Prompt deleted' }),
          }
        ),
    });
  };

  const movePromptToFolder = (prompt: PromptLibraryPrompt, folderId: string | undefined) => {
    if ((prompt.folderId ?? undefined) === folderId) return;
    if (folderId) {
      // Reveal the destination so the moved prompt doesn't vanish into a
      // collapsed folder.
      setExpandedFolders((prev) => new Set(prev).add(folderId));
    }
    const nextPrompts = promptLibrary.map((item) =>
      item.id === prompt.id ? withFolderId(item, folderId) : item
    );
    updatePromptLibrary(
      {
        prompts: buildSections(nextPrompts, folders).flatMap((section) => section.prompts),
        folders,
      },
      {
        onSuccess: () => toast({ title: 'Prompt moved' }),
      }
    );
  };

  const createFolder = () => {
    showFolderModal({
      existingNames: folders.map((folder) => folder.name),
      onSuccess: (name: string) =>
        updatePromptLibrary(
          { prompts: promptLibrary, folders: [...folders, { id: createId('folder'), name }] },
          {
            onSuccess: () => toast({ title: 'Folder added' }),
          }
        ),
    });
  };

  const renameFolder = (folder: PromptLibraryFolder) => {
    showFolderModal({
      initialName: folder.name,
      existingNames: folders.filter((item) => item.id !== folder.id).map((item) => item.name),
      onSuccess: (name: string) =>
        updatePromptLibrary(
          {
            prompts: promptLibrary,
            folders: folders.map((item) => (item.id === folder.id ? { ...item, name } : item)),
          },
          {
            onSuccess: () => toast({ title: 'Folder renamed' }),
          }
        ),
    });
  };

  const deleteFolder = (folder: PromptLibraryFolder) => {
    showConfirm({
      title: 'Delete folder?',
      description: `"${folder.name}" will be removed. Prompts inside are kept and moved out of the folder.`,
      confirmLabel: 'Delete',
      onSuccess: () =>
        updatePromptLibrary(
          {
            prompts: promptLibrary.map((item) =>
              item.folderId === folder.id ? withFolderId(item, undefined) : item
            ),
            folders: folders.filter((item) => item.id !== folder.id),
          },
          {
            onSuccess: () => toast({ title: 'Folder deleted' }),
          }
        ),
    });
  };

  const toggleFolder = (folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const collapseAutoExpandedFolders = (keepFolderId: string | undefined) => {
    const autoExpanded = autoExpandedFoldersRef.current;
    autoExpandedFoldersRef.current = new Set();
    if (autoExpanded.size === 0) return;
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      for (const folderId of autoExpanded) {
        if (folderId !== keepFolderId) next.delete(folderId);
      }
      return next;
    });
  };

  const commitPrompts = (nextPrompts: PromptLibraryPrompt[]) => {
    // Persist in grouped order so stored order and display order stay in sync.
    const grouped = buildSections(nextPrompts, folders).flatMap((section) => section.prompts);
    setPendingOrder(grouped);
    reorderPromptLibrary({ prompts: grouped, folders }, { onSettled: () => setPendingOrder(null) });
  };

  const handleDragStart = (event: DragStartEvent) => {
    const prompt = viewPrompts.find((item) => item.id === event.active.id);
    setDragState({
      id: String(event.active.id),
      originFolderId: normalizeFolderId(prompt?.folderId),
    });
  };

  // Moves the dragged prompt between sections as the pointer crosses them so
  // the preview shows where it would land. Same-section moves are left to the
  // sortable transforms and resolved in onDragEnd.
  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeIndex = displayPrompts.findIndex((item) => item.id === active.id);
    if (activeIndex === -1) return;
    const activePrompt = displayPrompts[activeIndex];
    const activeFolderId = normalizeFolderId(activePrompt.folderId);

    const zone = getFolderZoneData(over.data.current);
    const overIndex = zone ? -1 : displayPrompts.findIndex((item) => item.id === over.id);
    if (!zone && overIndex === -1) return;
    const targetFolderId = zone
      ? (zone.folderId ?? undefined)
      : normalizeFolderId(displayPrompts[overIndex].folderId);
    if (targetFolderId === activeFolderId) return;

    // Spring-open collapsed folders so the drop preview is visible inside.
    if (targetFolderId && !isSearching && !expandedFolders.has(targetFolderId)) {
      autoExpandedFoldersRef.current.add(targetFolderId);
      setExpandedFolders((prev) => new Set(prev).add(targetFolderId));
    }

    const without = displayPrompts.filter((item) => item.id !== active.id);
    const moved = withFolderId(activePrompt, targetFolderId);
    if (zone) {
      // Hovering a section's empty space appends to that section.
      setDraftPrompts([...without, moved]);
      return;
    }
    const overWithoutIndex = without.findIndex((item) => item.id === over.id);
    if (overWithoutIndex === -1) return;
    const isBelowOverItem =
      active.rect.current.translated !== null &&
      active.rect.current.translated.top > over.rect.top + over.rect.height / 2;
    const next = [...without];
    next.splice(overWithoutIndex + (isBelowOverItem ? 1 : 0), 0, moved);
    setDraftPrompts(next);
  };

  const handleDragCancel = () => {
    collapseAutoExpandedFolders(undefined);
    setDragState(null);
    setDraftPrompts(null);
  };

  // The drag preview already holds any cross-section move; here we resolve the
  // final in-section position and persist.
  const handleDragEnd = (event: DragEndEvent) => {
    const originFolderId = dragState?.originFolderId;
    const hadDraft = draftPrompts !== null;
    setDragState(null);
    setDraftPrompts(null);
    const { active, over } = event;
    const activeIndex = displayPrompts.findIndex((item) => item.id === active.id);
    if (activeIndex === -1) {
      collapseAutoExpandedFolders(undefined);
      return;
    }
    const activePrompt = displayPrompts[activeIndex];
    const finalFolderId = normalizeFolderId(activePrompt.folderId);
    const folderChanged = finalFolderId !== originFolderId;
    collapseAutoExpandedFolders(folderChanged ? finalFolderId : undefined);

    let next = displayPrompts;
    if (over && over.id !== active.id && !getFolderZoneData(over.data.current)) {
      const overIndex = displayPrompts.findIndex((item) => item.id === over.id);
      if (
        overIndex !== -1 &&
        normalizeFolderId(displayPrompts[overIndex].folderId) === finalFolderId
      ) {
        next = arrayMove(displayPrompts, activeIndex, overIndex);
      }
    }
    if (next === displayPrompts && !hadDraft) return;
    if (folderChanged && finalFolderId) {
      // Keep the destination revealed so the moved prompt doesn't vanish into
      // a collapsed folder.
      setExpandedFolders((prev) => new Set(prev).add(finalFolderId));
    }
    commitPrompts(next);
  };

  const renderSectionPrompts = (section: PromptSection) => (
    <SortableContext
      items={section.prompts.map((item) => item.id)}
      strategy={verticalListSortingStrategy}
    >
      {section.prompts.map((prompt, index) => (
        <SortablePromptItem
          key={prompt.id}
          id={prompt.id}
          isLast={index === section.prompts.length - 1}
          canDrag={canDragPrompts}
        >
          <ContextMenu>
            <ContextMenuTrigger className="flex w-full">
              <PromptRow
                item={prompt}
                disabled={isDisabled}
                onEdit={() => editPrompt(prompt)}
                onDelete={() => deletePrompt(prompt)}
              />
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => editPrompt(prompt)}>
                <Pencil />
                Edit
              </ContextMenuItem>
              {folders.length > 0 && (
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <FolderInput className="text-foreground-muted" />
                    Move to folder
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent>
                    {folders.map((folder) => (
                      <ContextMenuItem
                        key={folder.id}
                        disabled={folder.id === section.folder?.id}
                        onClick={() => movePromptToFolder(prompt, folder.id)}
                      >
                        <Folder />
                        <span className="truncate">{folder.name}</span>
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              )}
              {section.folder && (
                <ContextMenuItem onClick={() => movePromptToFolder(prompt, undefined)}>
                  <FolderMinus />
                  Remove from folder
                </ContextMenuItem>
              )}
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onClick={() => deletePrompt(prompt)}>
                <Trash2 />
                Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </SortablePromptItem>
      ))}
    </SortableContext>
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-8 py-8">
        <PageHeader
          title="Prompts"
          description="Manage reusable prompts that can be sent from task prompt menus. Drag to reorder or to move prompts in and out of folders."
        >
          <div className="flex w-full justify-between gap-2">
            <SearchInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search prompts..."
            />
            <div className="flex shrink-0 gap-2">
              <Button
                variant="outline"
                onClick={createFolder}
                disabled={isDisabled}
                aria-label="New Folder"
              >
                <FolderPlus className="size-4" />
                <span className="[@container(max-width:520px)]:hidden">New Folder</span>
              </Button>
              <Button onClick={createPrompt} disabled={isDisabled} aria-label="New Prompt">
                <Plus className="size-4" />
                <span className="[@container(max-width:520px)]:hidden">New Prompt</span>
              </Button>
            </div>
          </div>
        </PageHeader>
        <div className={cn('flex flex-col py-2', !hasVisibleContent && 'min-h-64')}>
          {hasVisibleContent ? (
            <DndContext
              sensors={sensors}
              collisionDetection={collisionDetection}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragCancel={handleDragCancel}
              onDragEnd={handleDragEnd}
            >
              {visibleSections.map((section) => {
                const folder = section.folder;
                if (!folder) {
                  // While dragging a foldered prompt the ungrouped section stays
                  // droppable even when empty, so prompts can be dragged out.
                  if (section.prompts.length === 0 && dragState === null) return null;
                  return (
                    <PromptSectionZone
                      key="ungrouped"
                      zoneId="prompt-section:ungrouped"
                      folderId={null}
                      disabled={!canDragPrompts}
                    >
                      {section.prompts.length > 0 ? (
                        renderSectionPrompts(section)
                      ) : (
                        <div className="h-14" />
                      )}
                    </PromptSectionZone>
                  );
                }
                const isCollapsed = !isSearching && !expandedFolders.has(folder.id);
                return (
                  <PromptSectionZone
                    key={folder.id}
                    zoneId={`prompt-section:${folder.id}`}
                    folderId={folder.id}
                    disabled={!canDragPrompts}
                  >
                    <FolderSectionHeader
                      folder={folder}
                      count={section.prompts.length}
                      collapsed={isCollapsed}
                      isDragActive={dragState !== null}
                      isDropTarget={dragFolderChanged && currentDragFolderId === folder.id}
                      disabled={isDisabled}
                      onToggle={() => toggleFolder(folder.id)}
                      onRename={() => renameFolder(folder)}
                      onDelete={() => deleteFolder(folder)}
                    />
                    {!isCollapsed && (
                      <div className="flex flex-col pl-5">
                        {section.prompts.length > 0 ? (
                          renderSectionPrompts(section)
                        ) : (
                          <div className="px-3 py-2 text-xs text-foreground-muted">
                            No prompts in this folder yet.
                          </div>
                        )}
                      </div>
                    )}
                  </PromptSectionZone>
                );
              })}
              <DragOverlay dropAnimation={null}>
                {activeDragPrompt ? (
                  <PromptDragGhost prompt={activeDragPrompt} badge={ghostBadge} />
                ) : null}
              </DragOverlay>
            </DndContext>
          ) : (
            <EmptyState
              label="No prompts"
              description={search ? 'No prompts match your search.' : 'No prompts available.'}
            />
          )}
        </div>
      </div>
    </div>
  );
}
