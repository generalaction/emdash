import { useSyncExternalStore } from 'react';
import { modelRegistry, type ModelStatus } from './monaco-model-registry';

/**
 * Returns the loading status of a registered model, updating whenever it changes.
 * Gates diff/code editor rendering: wait for `'ready'` before rendering editors.
 *
 * Also activates FS watching for the URI's task while the component is mounted
 * (subscriber count 0→1 starts FS watch + polling; 1→0 stops them).
 *
 * @param uri — a typed URI: disk://, git://, or file:// buffer URI
 */
export function useModelStatus(uri: string): ModelStatus {
  return useSyncExternalStore(
    (cb) => modelRegistry.subscribeToUri(uri, cb),
    () => modelRegistry.getStatus(uri)
  );
}

/**
 * Returns true when the buffer model at `bufferUri` has unsaved changes relative
 * to the on-disk content. Updates reactively whenever the buffer is edited, saved,
 * or reloaded from disk.
 *
 * Subscribing to a file:// URI has no FS-watching side effects — only disk:// and
 * git:// URIs activate watchers.
 *
 * @param bufferUri — a file:// buffer URI
 */
export function useIsDirty(bufferUri: string): boolean {
  return useSyncExternalStore(
    (cb) => modelRegistry.subscribeToUri(bufferUri, cb),
    () => modelRegistry.isDirty(bufferUri)
  );
}
