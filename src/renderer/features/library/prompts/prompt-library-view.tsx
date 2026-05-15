import { Pencil, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { Input } from '@renderer/lib/ui/input';
import { cn } from '@renderer/utils/utils';
import type { PromptFormResult, PromptLibraryPrompt } from './prompt-modal';

type PromptListItem =
  | {
      kind: 'review';
      id: 'review-prompt';
      title: string;
      prompt: string;
      canReset: boolean;
    }
  | {
      kind: 'custom';
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
  onReset,
  onDelete,
}: {
  item: PromptListItem;
  disabled: boolean;
  onEdit: () => void;
  onReset?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="group flex min-h-[68px] items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 transition-colors hover:bg-background-1">
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={onEdit}
        disabled={disabled}
      >
        <div className="truncate text-sm font-medium text-foreground">{item.title}</div>
        <div className="mt-1 line-clamp-1 text-xs leading-relaxed text-foreground-muted">
          {item.prompt}
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onEdit}
          disabled={disabled}
          aria-label={`Edit ${item.title}`}
        >
          <Pencil />
        </Button>
        {item.kind === 'review' ? (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onReset}
            disabled={disabled || !item.canReset}
            aria-label="Reset review prompt"
          >
            <RotateCcw />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onDelete}
            disabled={disabled}
            aria-label={`Delete ${item.title}`}
          >
            <Trash2 />
          </Button>
        )}
      </div>
    </div>
  );
}

export function PromptLibraryView() {
  const {
    value: reviewPromptValue,
    defaults: reviewPromptDefault,
    update: updateReviewPrompt,
    reset: resetReviewPrompt,
    isLoading: isReviewPromptLoading,
    isSaving: isReviewPromptSaving,
  } = useAppSettingsKey('reviewPrompt');
  const {
    value: promptLibraryValue,
    update: updatePromptLibrary,
    isLoading: isPromptLibraryLoading,
    isSaving: isPromptLibrarySaving,
  } = useAppSettingsKey('promptLibrary');
  const showPromptModal = useShowModal('promptModal');
  const showConfirm = useShowModal('confirmActionModal');
  const [search, setSearch] = useState('');

  const reviewPrompt = reviewPromptValue ?? '';
  const promptLibrary = useMemo(() => promptLibraryValue ?? [], [promptLibraryValue]);
  const isDisabled =
    isReviewPromptLoading ||
    isReviewPromptSaving ||
    isPromptLibraryLoading ||
    isPromptLibrarySaving;

  const items = useMemo<PromptListItem[]>(() => {
    const reviewItem: PromptListItem = {
      kind: 'review',
      id: 'review-prompt',
      title: 'Review prompt',
      prompt: reviewPrompt,
      canReset: reviewPrompt !== (reviewPromptDefault ?? ''),
    };
    const customItems: PromptListItem[] = promptLibrary.map((prompt) => ({
      kind: 'custom',
      id: prompt.id,
      title: prompt.title,
      prompt: prompt.prompt,
    }));
    return [reviewItem, ...customItems];
  }, [promptLibrary, reviewPrompt, reviewPromptDefault]);

  const filteredItems = useMemo(
    () => items.filter((item) => matchesSearch(item, search.trim())),
    [items, search]
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

  const editReviewPrompt = () => {
    showPromptModal({
      initialPrompt: { title: 'Review prompt', prompt: reviewPrompt },
      titleReadonly: true,
      onSuccess: (result: PromptFormResult) => updateReviewPrompt(result.prompt),
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
      <div className="mx-auto w-full max-w-3xl px-8 py-8">
        <div className="mb-6">
          <h1 className="text-lg font-semibold">Prompts</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Manage reusable prompts that can be sent from task prompt menus.
          </p>
        </div>

        <div className="prompt-library-toolbar mb-6 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search prompts..."
              className="pl-9"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={createPrompt}
            disabled={isDisabled}
            aria-label="New Prompt"
          >
            <Plus className="prompt-library-new-prompt-icon mr-1.5 h-3.5 w-3.5" />
            <span className="prompt-library-new-prompt-label">New Prompt</span>
          </Button>
        </div>

        <div className={cn('flex flex-col gap-2', filteredItems.length === 0 && 'min-h-64')}>
          {filteredItems.length > 0 ? (
            filteredItems.map((item) => {
              if (item.kind === 'review') {
                return (
                  <PromptRow
                    key={item.id}
                    item={item}
                    disabled={isDisabled}
                    onEdit={editReviewPrompt}
                    onReset={() => resetReviewPrompt()}
                  />
                );
              }

              const prompt = promptLibrary.find((candidate) => candidate.id === item.id);
              if (!prompt) return null;
              return (
                <PromptRow
                  key={item.id}
                  item={item}
                  disabled={isDisabled}
                  onEdit={() => editPrompt(prompt)}
                  onDelete={() => deletePrompt(prompt)}
                />
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
