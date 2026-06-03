import type { PromptLibraryFolder } from '@shared/prompt-library';
import type { ContextAction, PromptContextAction } from './context-actions';

export type AddContextListEntry =
  | { kind: 'action'; id: string; action: ContextAction }
  | { kind: 'folder'; id: string; folder: PromptLibraryFolder; promptCount: number };

function matchesPromptAction(action: PromptContextAction, query: string) {
  const q = query.toLowerCase();
  return (
    action.prompt.title.toLowerCase().includes(q) ||
    (action.folder?.title.toLowerCase().includes(q) ?? false) ||
    action.prompt.prompt.toLowerCase().includes(q)
  );
}

function folderMatchesQuery(
  folder: PromptLibraryFolder,
  promptActions: PromptContextAction[],
  query: string
) {
  const q = query.toLowerCase();
  if (folder.title.toLowerCase().includes(q)) return true;
  return promptActions.some(
    (action) => action.folder?.id === folder.id && matchesPromptAction(action, q)
  );
}

export function buildAddContextListEntries(args: {
  actions: ContextAction[];
  folders: PromptLibraryFolder[];
  browseFolderId: string | null;
  query: string;
}): AddContextListEntry[] {
  const { actions, folders, browseFolderId, query } = args;
  const normalizedQuery = query.trim();
  const nonPromptActions = actions.filter((action) => action.kind !== 'prompt');
  const promptActions = actions.filter(
    (action): action is PromptContextAction => action.kind === 'prompt'
  );
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));

  const unfiledPromptActions = promptActions.filter(
    (action) => !action.prompt.folderId || !foldersById.has(action.prompt.folderId)
  );

  if (normalizedQuery) {
    const entries: AddContextListEntry[] = [];

    for (const action of nonPromptActions) {
      if (action.kind === 'linked-issue') {
        const q = normalizedQuery.toLowerCase();
        if (
          action.issue.title.toLowerCase().includes(q) ||
          action.issue.identifier.toLowerCase().includes(q)
        ) {
          entries.push({ kind: 'action', id: action.id, action });
        }
      } else if (
        action.kind === 'draft-comments' &&
        'line comments'.includes(normalizedQuery.toLowerCase())
      ) {
        entries.push({ kind: 'action', id: action.id, action });
      }
    }

    for (const folder of folders) {
      if (folderMatchesQuery(folder, promptActions, normalizedQuery)) {
        entries.push({
          kind: 'folder',
          id: `folder:${folder.id}`,
          folder,
          promptCount: promptActions.filter((action) => action.folder?.id === folder.id).length,
        });
      }
    }

    for (const action of promptActions) {
      if (matchesPromptAction(action, normalizedQuery)) {
        entries.push({ kind: 'action', id: action.id, action });
      }
    }

    return entries;
  }

  if (browseFolderId) {
    const folder = foldersById.get(browseFolderId);
    if (!folder) {
      return [
        ...nonPromptActions.map((action) => ({ kind: 'action' as const, id: action.id, action })),
        ...unfiledPromptActions.map((action) => ({
          kind: 'action' as const,
          id: action.id,
          action,
        })),
      ];
    }

    const folderPrompts = promptActions.filter((action) => action.folder?.id === folder.id);
    return folderPrompts.map((action) => ({ kind: 'action' as const, id: action.id, action }));
  }

  const folderEntries: AddContextListEntry[] = folders.map((folder) => ({
    kind: 'folder',
    id: `folder:${folder.id}`,
    folder,
    promptCount: promptActions.filter((action) => action.folder?.id === folder.id).length,
  }));

  return [
    ...folderEntries,
    ...nonPromptActions.map((action) => ({ kind: 'action' as const, id: action.id, action })),
    ...unfiledPromptActions.map((action) => ({ kind: 'action' as const, id: action.id, action })),
  ];
}

export function getAddContextConfirmableEntry(
  entries: AddContextListEntry[],
  selected: AddContextListEntry | null
): ContextAction | null {
  const entry = selected ?? entries.find((item) => item.kind === 'action') ?? null;
  return entry?.kind === 'action' ? entry.action : null;
}
