import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { MultiLineListItem } from '@renderer/lib/components/multi-line-list-item';
import { PageHeader } from '@renderer/lib/components/page-header';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { SearchInput } from '@renderer/lib/ui/search-input';
import { cn } from '@renderer/utils/utils';
import type { PromptLibraryPrompt } from '@shared/prompt-library';
import type { PromptFormResult } from './prompt-modal';
import { usePromptLibrary } from './use-prompt-library';

type PromptListItem = {
  id: string;
  title: string;
  prompt: string;
};

function createPromptId() {
  return globalThis.crypto?.randomUUID?.() ?? `prompt-${Date.now()}`;
}

function matchesSearch(item: PromptListItem, search: string) {
  if (!search) return true;
  const haystack = `${item.title} ${item.prompt}`.toLowerCase();
  return haystack.includes(search.toLowerCase());
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

export function PromptLibraryView() {
  const {
    value: promptLibraryValue,
    update: updatePromptLibrary,
    isLoading: isPromptLibraryLoading,
    isSaving: isPromptLibrarySaving,
  } = usePromptLibrary();
  const showPromptModal = useShowModal('promptModal');
  const showConfirm = useShowModal('confirmActionModal');
  const [search, setSearch] = useState('');

  const promptLibrary = useMemo(() => promptLibraryValue ?? [], [promptLibraryValue]);
  const isDisabled = isPromptLibraryLoading || isPromptLibrarySaving;

  const filteredItems = useMemo(
    () => promptLibrary.filter((item) => matchesSearch(item, search.trim())),
    [promptLibrary, search]
  );

  const upsertPrompt = (prompt: PromptLibraryPrompt) => {
    const exists = promptLibrary.some((item) => item.id === prompt.id);
    const nextPrompts = exists
      ? promptLibrary.map((item) => (item.id === prompt.id ? prompt : item))
      : [...promptLibrary, prompt];
    updatePromptLibrary(nextPrompts);
  };

  const createPrompt = () => {
    showPromptModal({
      onSuccess: (result: PromptFormResult) => {
        upsertPrompt({ id: createPromptId(), ...result });
      },
    });
  };

  const editPrompt = (prompt: PromptLibraryPrompt) => {
    showPromptModal({
      initialPrompt: prompt,
      onSuccess: (result: PromptFormResult) => upsertPrompt({ ...prompt, ...result }),
    });
  };

  const deletePrompt = (prompt: PromptLibraryPrompt) => {
    showConfirm({
      title: 'Delete prompt?',
      description: `"${prompt.title}" will be removed from the prompt library.`,
      confirmLabel: 'Delete',
      onSuccess: () => updatePromptLibrary(promptLibrary.filter((item) => item.id !== prompt.id)),
    });
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl p-8">
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
            <Button onClick={createPrompt} disabled={isDisabled} aria-label="New Prompt">
              <Plus className="size-4" />
              <span className="[@container(max-width:520px)]:hidden">New Prompt</span>
            </Button>
          </div>
        </PageHeader>
        <div className={cn('flex flex-col py-2', filteredItems.length === 0 && 'min-h-64')}>
          {filteredItems.length > 0 ? (
            filteredItems.map((prompt, index) => {
              return (
                <MultiLineListItem
                  key={prompt.id}
                  isLast={index === filteredItems.length - 1}
                  className="py-3"
                >
                  <PromptRow
                    item={prompt}
                    disabled={isDisabled}
                    onEdit={() => editPrompt(prompt)}
                    onDelete={() => deletePrompt(prompt)}
                  />
                </MultiLineListItem>
              );
            })
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
