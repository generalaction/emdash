export const UNFILED_DROP_ID = 'prompt-library-unfiled';

const PROMPT_PREFIX = 'prompt::';
const FOLDER_PREFIX = 'folder::';

export function toPromptDndId(promptId: string) {
  return `${PROMPT_PREFIX}${promptId}`;
}

export function toFolderDndId(folderId: string) {
  return `${FOLDER_PREFIX}${folderId}`;
}

export type PromptLibraryDndTarget =
  | { kind: 'prompt'; promptId: string }
  | { kind: 'folder'; folderId: string }
  | { kind: 'unfiled' };

export function parsePromptLibraryDndId(id: string): PromptLibraryDndTarget | null {
  if (id === UNFILED_DROP_ID) return { kind: 'unfiled' };
  if (id.startsWith(PROMPT_PREFIX)) {
    const promptId = id.slice(PROMPT_PREFIX.length);
    return promptId ? { kind: 'prompt', promptId } : null;
  }
  if (id.startsWith(FOLDER_PREFIX)) {
    const folderId = id.slice(FOLDER_PREFIX.length);
    return folderId ? { kind: 'folder', folderId } : null;
  }
  return null;
}
