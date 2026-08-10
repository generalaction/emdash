import { createListView, createTextMatcher } from '@emdash/ui/react/patterns';
import type { PromptLibraryPrompt } from '@core/primitives/prompt-library/api';

/**
 * The list-view state layer for the prompt library: sync source fed by a
 * reactive getter (the component wraps query data in an observable box so the
 * pipeline re-derives) plus immediate client-side search over the title and
 * the prompt body. Items keep the library's stored order.
 */
export function createPromptLibraryListView(getPrompts: () => PromptLibraryPrompt[]) {
  return createListView({
    getItemId: (prompt: PromptLibraryPrompt) => prompt.id,
    source: { kind: 'sync', items: getPrompts },
    search: {
      kind: 'sync',
      predicate: createTextMatcher((prompt: PromptLibraryPrompt) => [prompt.title, prompt.prompt]),
    },
  });
}

export type PromptLibraryListViewModel = ReturnType<typeof createPromptLibraryListView>;
