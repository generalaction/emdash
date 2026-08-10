import { CollectionToolbar, CollectionView, PageLayout } from '@emdash/ui/react/patterns';
import { Button, DropdownMenu, Spinner, toast } from '@emdash/ui/react/primitives';
import { EllipsisIcon, LibraryIcon, Pencil, Plus, Trash2 } from 'lucide-react';
import { observable, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useLayoutEffect, useState } from 'react';
import { usePromptLibrary } from '@core/features/library/api/browser/prompts/use-prompt-library';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { useSearchFocusHotkeys } from '@core/primitives/keybindings/browser';
import type { PromptLibraryPrompt } from '@core/primitives/prompt-library/api';
import {
  createPromptLibraryListView,
  type PromptLibraryListViewModel,
} from './prompt-library-list-model';

function createPromptId() {
  return globalThis.crypto?.randomUUID?.() ?? `prompt-${Date.now()}`;
}

/** Row content (two-line text + tiered actions) — the CollectionView shell owns interaction. */
function PromptRow({
  item,
  disabled,
  onEdit,
  onDelete,
}: {
  item: PromptLibraryPrompt;
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group flex w-full items-center">
      <div className="min-w-0 flex-1">
        <div className="text-md truncate text-foreground">{item.title}</div>
        <div className="mt-1 line-clamp-1 text-xs leading-relaxed text-foreground-muted">
          {item.prompt}
        </div>
      </div>
      {/* Trailing actions are explicit controls — clicks must not reach the row. */}
      <div
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className="flex shrink-0 items-center gap-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
      >
        <Button
          variant="ghost"
          size="xs"
          icon
          onClick={onEdit}
          disabled={disabled}
          aria-label={`Edit ${item.title}`}
        >
          <Pencil />
        </Button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="xs"
                icon
                disabled={disabled}
                aria-label={`Actions for ${item.title}`}
              />
            }
          >
            <EllipsisIcon className="size-3.5" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            <DropdownMenu.Item onClick={onEdit}>
              <Pencil />
              Edit…
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item variant="destructive" onClick={onDelete}>
              <Trash2 />
              Delete…
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
    </div>
  );
}

export function PromptLibraryView() {
  const {
    value: promptLibrary,
    update: updatePromptLibrary,
    isLoading: isPromptLibraryLoading,
    isSaving: isPromptLibrarySaving,
  } = usePromptLibrary();
  const openPromptModal = useOpenModal('promptModal');
  const openConfirm = useOpenModal('confirmActionModal');

  const isDisabled = isPromptLibraryLoading || isPromptLibrarySaving;

  // Bridge query data into the view's sync source: seed the box so the first
  // render sees data, and update before paint to avoid an empty flash.
  const [itemsBox] = useState(() =>
    observable.box<PromptLibraryPrompt[]>(promptLibrary, { deep: false })
  );
  const [view] = useState(() => createPromptLibraryListView(() => itemsBox.get()));
  useLayoutEffect(() => {
    runInAction(() => itemsBox.set(promptLibrary));
  }, [promptLibrary, itemsBox]);

  const upsertPrompt = (prompt: PromptLibraryPrompt, successTitle: string) => {
    const exists = promptLibrary.some((item) => item.id === prompt.id);
    const nextPrompts = exists
      ? promptLibrary.map((item) => (item.id === prompt.id ? prompt : item))
      : [...promptLibrary, prompt];
    updatePromptLibrary(nextPrompts, {
      onSuccess: () => toast(successTitle),
    });
  };

  const createPrompt = () => {
    void openPromptModal().then((outcome) => {
      if (!outcome.success) return;
      upsertPrompt({ id: createPromptId(), ...outcome.data }, 'Prompt added');
    });
  };

  const editPrompt = (prompt: PromptLibraryPrompt) => {
    void openPromptModal({
      initialPrompt: prompt,
    }).then((outcome) => {
      if (!outcome.success) return;
      upsertPrompt({ ...prompt, ...outcome.data }, 'Prompt updated');
    });
  };

  const deletePrompt = (prompt: PromptLibraryPrompt) => {
    void openConfirm({
      title: 'Delete prompt?',
      description: `"${prompt.title}" will be removed from the prompt library.`,
      confirmLabel: 'Delete',
    }).then((outcome) => {
      if (!outcome.success) return;
      updatePromptLibrary(
        promptLibrary.filter((item) => item.id !== prompt.id),
        {
          onSuccess: () => toast('Prompt deleted'),
        }
      );
    });
  };

  return (
    <div className="flex min-h-0 flex-col gap-4 text-foreground">
      <PageLayout.Header
        sticky
        title="Prompts"
        description="Manage reusable prompts that can be sent from task prompt menus."
      />
      <view.Root>
        <CollectionView
          view={view}
          renderRow={(prompt) => (
            <PromptRow
              item={prompt}
              disabled={isDisabled}
              onEdit={() => editPrompt(prompt)}
              onDelete={() => deletePrompt(prompt)}
            />
          )}
          toolbar={<PromptsToolbar view={view} onNewPrompt={createPrompt} disabled={isDisabled} />}
          onItemClick={(prompt) => {
            if (!isDisabled) editPrompt(prompt);
          }}
          emptySlot={
            isPromptLibraryLoading ? (
              <PromptsLoadingState />
            ) : (
              <PromptsEmptyState hasPrompts={promptLibrary.length > 0} />
            )
          }
        />
      </view.Root>
    </div>
  );
}

const PromptsToolbar = observer(function PromptsToolbar({
  view,
  onNewPrompt,
  disabled,
}: {
  view: PromptLibraryListViewModel;
  onNewPrompt: () => void;
  disabled: boolean;
}) {
  const search = view.useSearch();
  const searchRef = useSearchFocusHotkeys();
  return (
    <CollectionToolbar
      ref={searchRef}
      searchValue={search.query}
      onSearchValueChange={search.setQuery}
      searchPlaceholder="Search prompts…"
      actions={
        <Button variant="primary" onClick={onNewPrompt} disabled={disabled} aria-label="New Prompt">
          <Plus className="size-4" />
          <span className="[@container(max-width:520px)]:hidden">New Prompt</span>
        </Button>
      }
    />
  );
});

// The view's sync source is never "loading", so the query's pending state
// routes through the empty slot rather than CollectionView's loadingSlot.
function PromptsLoadingState() {
  return (
    <div className="flex min-h-48 items-center justify-center p-8">
      <Spinner />
    </div>
  );
}

function PromptsEmptyState({ hasPrompts }: { hasPrompts: boolean }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center p-8 text-center">
      <LibraryIcon className="mb-3 size-8 text-foreground-passive" />
      <div className="text-sm text-foreground">
        {hasPrompts ? 'No prompts match your search' : 'No prompts'}
      </div>
      <p className="mt-1 max-w-sm text-xs text-foreground-passive">
        {hasPrompts
          ? 'Try a different title or prompt text.'
          : 'Add a prompt to reuse it from task prompt menus.'}
      </p>
    </div>
  );
}
