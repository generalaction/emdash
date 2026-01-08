/**
 * File change event system for notifying components when files are saved
 * This allows the CodeEditor to notify the FileChangesPanel to refresh immediately
 */

export const FILE_CHANGE_EVENT = 'file-change-notification';

export interface FileChangeEvent {
  taskPath: string;
  filePath?: string;
}

/**
 * Dispatch a file change event to notify listeners that files have been saved
 */
export function dispatchFileChangeEvent(taskPath: string, filePath?: string): void {
  const event = new CustomEvent(FILE_CHANGE_EVENT, {
    detail: { taskPath, filePath },
  });
  window.dispatchEvent(event);
}

/**
 * Subscribe to file change events
 * Returns a cleanup function to remove the listener
 */
export function subscribeToFileChanges(
  callback: (event: CustomEvent<FileChangeEvent>) => void
): () => void {
  const handler = (e: Event) => {
    callback(e as CustomEvent<FileChangeEvent>);
  };
  window.addEventListener(FILE_CHANGE_EVENT, handler);
  return () => window.removeEventListener(FILE_CHANGE_EVENT, handler);
}
