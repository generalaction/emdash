import {
  DndContext,
  DragOverlay,
  MouseSensor,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { ChevronRight, Folder, FolderOpen, FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { PageHeader } from '@renderer/lib/components/page-header';
import { toast } from '@renderer/lib/hooks/use-toast';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@renderer/lib/ui/collapsible';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { SearchInput } from '@renderer/lib/ui/search-input';
import { cn } from '@renderer/utils/utils';
import type { PromptLibraryFolder, PromptLibraryPrompt } from '@shared/prompt-library';
import type { FolderFormResult } from './folder-modal';
import {
  parsePromptLibraryDndId,
  toFolderDndId,
  UNFILED_DROP_ID,
} from './prompt-library-dnd';
import { PromptLibraryPromptRow } from './prompt-library-prompt-row';
import type { PromptFormResult } from './prompt-modal';
import { usePromptLibrary } from './use-prompt-library';

type PromptListItem = {
  id: string;
  title: string;
  prompt: string;
  folderId?: string;
};

function createPromptId() {
  return globalThis.crypto?.randomUUID?.() ?? `prompt-${Date.now()}`;
}

function createFolderId() {
  return globalThis.crypto?.randomUUID?.() ?? `folder-${Date.now()}`;
}

function matchesSearch(item: PromptListItem, search: string) {
  if (!search) return true;
  const haystack = `${item.title} ${item.prompt}`.toLowerCase();
  return haystack.includes(search.toLowerCase());
}

function folderMatchesSearch(
  folder: PromptLibraryFolder,
  prompts: PromptLibraryPrompt[],
  search: string
) {
  if (!search) return true;
  const normalizedSearch = search.toLowerCase();
  return (
    folder.title.toLowerCase().includes(normalizedSearch) ||
    prompts.some((prompt) => matchesSearch(prompt, normalizedSearch))
  );
}

function FolderPromptList({
  children,
  isEmpty,
  isDragging,
  isDropTarget,
}: {
  children: ReactNode;
  isEmpty: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
}) {
  return (
    <div
      className={cn(
        'min-h-10 rounded-md border border-dashed border-transparent transition-colors',
        isDropTarget && 'border-primary/50 bg-primary/5',
        isEmpty && isDragging && !isDropTarget && 'border-border/60 bg-background-1/50'
      )}
    >
      {isEmpty && isDragging ? (
        <div className="px-3 py-3 text-xs text-foreground-muted">Drop prompt here</div>
      ) : null}
      {children}
    </div>
  );
}

function UnfiledDropZone({ children, isDragging }: { children: ReactNode; isDragging: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: UNFILED_DROP_ID });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-lg transition-colors',
        isDragging && isOver && 'bg-primary/5 ring-1 ring-primary/30 ring-inset'
      )}
    >
      {children}
    </div>
  );
}

function PromptFolderSection({
  folder,
  prompts,
  expanded,
  onExpandedChange,
  disabled,
  isDragging,
  onEditFolder,
  onDeleteFolder,
  onEditPrompt,
  onDeletePrompt,
  onMovePromptToFolder,
  allFolders,
}: {
  folder: PromptLibraryFolder;
  prompts: PromptLibraryPrompt[];
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  disabled: boolean;
  isDragging: boolean;
  onEditFolder: () => void;
  onDeleteFolder: () => void;
  onEditPrompt: (prompt: PromptLibraryPrompt) => void;
  onDeletePrompt: (prompt: PromptLibraryPrompt) => void;
  onMovePromptToFolder: (promptId: string, folderId: string | undefined) => void;
  allFolders: PromptLibraryFolder[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: toFolderDndId(folder.id) });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'mb-2 overflow-hidden rounded-lg border border-border bg-background-1/40',
        isOver && isDragging && 'border-primary/50 ring-1 ring-primary/30'
      )}
    >
      <Collapsible open={expanded} onOpenChange={onExpandedChange}>
        <div className="group flex items-center">
          <CollapsibleTrigger
            className={cn(
              'flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-foreground',
              'transition-colors hover:bg-background-1'
            )}
          >
            <ChevronRight
              className={cn(
                'size-4 shrink-0 text-foreground-muted transition-transform',
                expanded && 'rotate-90'
              )}
            />
            {expanded ? (
              <FolderOpen className="size-4 shrink-0 text-foreground-muted" />
            ) : (
              <Folder className="size-4 shrink-0 text-foreground-muted" />
            )}
            <span className="min-w-0 flex-1 truncate">{folder.title}</span>
          </CollapsibleTrigger>
          <div className="flex shrink-0 items-center gap-0.5 pr-2 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onEditFolder}
              disabled={disabled}
              aria-label={`Edit ${folder.title}`}
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onDeleteFolder}
              disabled={disabled}
              aria-label={`Delete ${folder.title}`}
            >
              <Trash2 />
            </Button>
          </div>
        </div>
        <CollapsibleContent>
          <FolderPromptList
            isEmpty={prompts.length === 0}
            isDragging={isDragging}
            isDropTarget={isOver}
          >
            <div className="border-t border-border/60 pl-2">
              {prompts.map((prompt, index) => (
                <PromptLibraryPromptRow
                  key={prompt.id}
                  prompt={prompt}
                  folders={allFolders}
                  disabled={disabled}
                  isLast={index === prompts.length - 1}
                  onEdit={() => onEditPrompt(prompt)}
                  onDelete={() => onDeletePrompt(prompt)}
                  onMoveToFolder={(folderId) => onMovePromptToFolder(prompt.id, folderId)}
                />
              ))}
            </div>
          </FolderPromptList>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export function PromptLibraryView() {
  const {
    value: promptLibraryValue,
    update: updatePromptLibrary,
    isLoading: isPromptLibraryLoading,
    isSaving: isPromptLibrarySaving,
  } = usePromptLibrary();
  const showPromptModal = useShowModal('promptModal');
  const showFolderModal = useShowModal('folderModal');
  const showConfirm = useShowModal('confirmActionModal');
  const [search, setSearch] = useState('');
  const [activeDragPromptId, setActiveDragPromptId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } })
  );

  const promptLibrary = useMemo(() => promptLibraryValue, [promptLibraryValue]);
  const isDisabled = isPromptLibraryLoading || isPromptLibrarySaving;
  const isDragging = activeDragPromptId !== null;

  const foldersById = useMemo(
    () => new Map(promptLibrary.folders.map((folder) => [folder.id, folder])),
    [promptLibrary.folders]
  );
  const normalizedSearch = search.trim();
  const isSearching = normalizedSearch.length > 0;

  const unfiledPrompts = useMemo(
    () => promptLibrary.prompts.filter((item) => !item.folderId || !foldersById.has(item.folderId)),
    [foldersById, promptLibrary.prompts]
  );
  const filteredUnfiledPrompts = useMemo(
    () => unfiledPrompts.filter((item) => matchesSearch(item, normalizedSearch)),
    [normalizedSearch, unfiledPrompts]
  );
  const folderSections = useMemo(
    () =>
      promptLibrary.folders
        .map((folder) => ({
          folder,
          prompts: promptLibrary.prompts.filter((prompt) => prompt.folderId === folder.id),
        }))
        .map(({ folder, prompts }) => ({
          folder,
          prompts,
          isFolderMatch:
            isSearching && folder.title.toLowerCase().includes(normalizedSearch.toLowerCase()),
        }))
        .filter(({ folder, prompts }) => folderMatchesSearch(folder, prompts, normalizedSearch))
        .map(({ folder, prompts, isFolderMatch }) => ({
          folder,
          prompts:
            isSearching && !isFolderMatch
              ? prompts.filter((prompt) => matchesSearch(prompt, normalizedSearch))
              : prompts,
        })),
    [isSearching, normalizedSearch, promptLibrary]
  );
  const hasVisibleItems = filteredUnfiledPrompts.length > 0 || folderSections.length > 0;

  const activeDragPrompt = useMemo(
    () =>
      activeDragPromptId
        ? (promptLibrary.prompts.find((p) => p.id === activeDragPromptId) ?? null)
        : null,
    [activeDragPromptId, promptLibrary.prompts]
  );

  const collapsedFolderIdSet = useMemo(() => {
    const validFolderIds = new Set(promptLibrary.folders.map((folder) => folder.id));
    return new Set((promptLibrary.collapsedFolderIds ?? []).filter((id) => validFolderIds.has(id)));
  }, [promptLibrary.collapsedFolderIds, promptLibrary.folders]);

  const isFolderExpanded = useCallback(
    (folderId: string) => isSearching || !collapsedFolderIdSet.has(folderId),
    [collapsedFolderIdSet, isSearching]
  );

  const setFolderExpanded = useCallback(
    (folderId: string, open: boolean) => {
      const next = new Set(collapsedFolderIdSet);
      if (open) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      const collapsedFolderIds = next.size > 0 ? [...next] : undefined;
      updatePromptLibrary({ ...promptLibrary, collapsedFolderIds });
    },
    [collapsedFolderIdSet, promptLibrary, updatePromptLibrary]
  );

  const upsertPrompt = (prompt: PromptLibraryPrompt, successTitle: string) => {
    const exists = promptLibrary.prompts.some((item) => item.id === prompt.id);
    const nextPrompts = exists
      ? promptLibrary.prompts.map((item) => (item.id === prompt.id ? prompt : item))
      : [...promptLibrary.prompts, prompt];
    updatePromptLibrary(
      { ...promptLibrary, prompts: nextPrompts },
      {
        onSuccess: () => toast({ title: successTitle }),
      }
    );
  };

  const assignPromptToFolder = useCallback(
    (promptId: string, folderId: string | undefined) => {
      const prompt = promptLibrary.prompts.find((p) => p.id === promptId);
      if (!prompt) return;
      if (prompt.folderId === folderId) return;

      const nextPrompts = promptLibrary.prompts.map((item) => {
        if (item.id !== promptId) return item;
        if (folderId === undefined) {
          const { folderId: _removed, ...rest } = item;
          return rest;
        }
        return { ...item, folderId };
      });

      const nextCollapsedFolderIds = new Set(collapsedFolderIdSet);
      if (folderId) {
        nextCollapsedFolderIds.delete(folderId);
      }

      updatePromptLibrary(
        {
          ...promptLibrary,
          prompts: nextPrompts,
          collapsedFolderIds:
            nextCollapsedFolderIds.size > 0 ? [...nextCollapsedFolderIds] : undefined,
        },
        {
          onSuccess: () => {
            toast({ title: folderId ? 'Prompt moved to folder' : 'Prompt removed from folder' });
          },
        }
      );
    },
    [collapsedFolderIdSet, promptLibrary, updatePromptLibrary]
  );

  const handleDragStart = (event: DragStartEvent) => {
    const parsed = parsePromptLibraryDndId(String(event.active.id));
    if (parsed?.kind === 'prompt') {
      setActiveDragPromptId(parsed.promptId);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragPromptId(null);
    const { active, over } = event;
    if (!over) return;

    const activeParsed = parsePromptLibraryDndId(String(active.id));
    const overParsed = parsePromptLibraryDndId(String(over.id));
    if (activeParsed?.kind !== 'prompt' || !overParsed) return;
    if (overParsed.kind === 'prompt' && activeParsed.promptId === overParsed.promptId) return;

    if (overParsed.kind === 'folder') {
      assignPromptToFolder(activeParsed.promptId, overParsed.folderId);
      return;
    }
    if (overParsed.kind === 'unfiled') {
      assignPromptToFolder(activeParsed.promptId, undefined);
    }
  };

  const createPrompt = () => {
    showPromptModal({
      folders: promptLibrary.folders,
      onSuccess: (result: PromptFormResult) => {
        upsertPrompt({ id: createPromptId(), ...result }, 'Prompt added');
      },
    });
  };

  const editPrompt = (prompt: PromptLibraryPrompt) => {
    showPromptModal({
      initialPrompt: prompt,
      folders: promptLibrary.folders,
      onSuccess: (result: PromptFormResult) =>
        upsertPrompt({ ...prompt, ...result }, 'Prompt updated'),
    });
  };

  const upsertFolder = (
    folder: PromptLibraryFolder,
    successTitle: string,
    options?: { startCollapsed?: boolean }
  ) => {
    const exists = promptLibrary.folders.some((item) => item.id === folder.id);
    const nextFolders = exists
      ? promptLibrary.folders.map((item) => (item.id === folder.id ? folder : item))
      : [...promptLibrary.folders, folder];
    const nextCollapsedFolderIds =
      !exists && options?.startCollapsed
        ? [...new Set([...(promptLibrary.collapsedFolderIds ?? []), folder.id])]
        : promptLibrary.collapsedFolderIds;
    updatePromptLibrary(
      {
        ...promptLibrary,
        folders: nextFolders,
        collapsedFolderIds: nextCollapsedFolderIds,
      },
      {
        onSuccess: () => toast({ title: successTitle }),
      }
    );
  };

  const createFolder = () => {
    showFolderModal({
      onSuccess: (result: FolderFormResult) => {
        upsertFolder({ id: createFolderId(), ...result }, 'Folder added', { startCollapsed: true });
      },
    });
  };

  const editFolder = (folder: PromptLibraryFolder) => {
    showFolderModal({
      initialFolder: folder,
      onSuccess: (result: FolderFormResult) =>
        upsertFolder({ ...folder, ...result }, 'Folder updated'),
    });
  };

  const deleteFolder = (folder: PromptLibraryFolder) => {
    showConfirm({
      title: 'Delete folder?',
      description: `"${folder.title}" will be removed. Prompts in this folder will stay in the library.`,
      confirmLabel: 'Delete',
      onSuccess: () =>
        updatePromptLibrary(
          {
            folders: promptLibrary.folders.filter((item) => item.id !== folder.id),
            prompts: promptLibrary.prompts.map((item) =>
              item.folderId === folder.id ? { ...item, folderId: undefined } : item
            ),
            collapsedFolderIds: promptLibrary.collapsedFolderIds?.filter((id) => id !== folder.id),
          },
          {
            onSuccess: () => toast({ title: 'Folder deleted' }),
          }
        ),
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
            ...promptLibrary,
            prompts: promptLibrary.prompts.filter((item) => item.id !== prompt.id),
          },
          {
            onSuccess: () => toast({ title: 'Prompt deleted' }),
          }
        ),
    });
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-8 py-8">
        <PageHeader
          title="Prompts"
          description="Manage reusable prompts that can be sent from task prompt menus."
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
                <span className="[@container(max-width:640px)]:hidden">New Folder</span>
              </Button>
              <Button onClick={createPrompt} disabled={isDisabled} aria-label="New Prompt">
                <Plus className="size-4" />
                <span className="[@container(max-width:520px)]:hidden">New Prompt</span>
              </Button>
            </div>
          </div>
        </PageHeader>

        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveDragPromptId(null)}
        >
          <div className={cn('flex flex-col gap-1 py-2', !hasVisibleItems && 'min-h-64')}>
            {hasVisibleItems ? (
              <>
                {folderSections.map(({ folder, prompts }) => (
                  <PromptFolderSection
                    key={folder.id}
                    folder={folder}
                    prompts={prompts}
                    expanded={isFolderExpanded(folder.id)}
                    onExpandedChange={(open) => setFolderExpanded(folder.id, open)}
                    disabled={isDisabled}
                    isDragging={isDragging}
                    onEditFolder={() => editFolder(folder)}
                    onDeleteFolder={() => deleteFolder(folder)}
                    onEditPrompt={editPrompt}
                    onDeletePrompt={deletePrompt}
                    onMovePromptToFolder={assignPromptToFolder}
                    allFolders={promptLibrary.folders}
                  />
                ))}
                {filteredUnfiledPrompts.length > 0 ? (
                  <UnfiledDropZone isDragging={isDragging}>
                    {filteredUnfiledPrompts.map((prompt, index) => (
                      <PromptLibraryPromptRow
                        key={prompt.id}
                        prompt={prompt}
                        folders={promptLibrary.folders}
                        disabled={isDisabled}
                        isLast={index === filteredUnfiledPrompts.length - 1}
                        onEdit={() => editPrompt(prompt)}
                        onDelete={() => deletePrompt(prompt)}
                        onMoveToFolder={(folderId) => assignPromptToFolder(prompt.id, folderId)}
                      />
                    ))}
                  </UnfiledDropZone>
                ) : isDragging ? (
                  <UnfiledDropZone isDragging={isDragging}>
                    <div className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-xs text-foreground-muted">
                      Drop here to remove from folder
                    </div>
                  </UnfiledDropZone>
                ) : null}
              </>
            ) : (
              <EmptyState
                label="No prompts"
                description={search ? 'No prompts match your search.' : 'No prompts available.'}
              />
            )}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeDragPrompt ? (
              <div className="rounded-lg border border-border bg-background px-3 py-2 shadow-md">
                <div className="text-sm font-medium text-foreground">{activeDragPrompt.title}</div>
                <div className="mt-0.5 line-clamp-1 text-xs text-foreground-muted">
                  {activeDragPrompt.prompt}
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
