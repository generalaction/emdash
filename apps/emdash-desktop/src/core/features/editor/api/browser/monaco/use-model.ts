import {
  modelRegistry,
  type ModelStatus,
} from '@core/features/editor/api/browser/monaco/monaco-model-registry';

/**
 * Returns the loading status of a registered model, updating reactively via MobX.
 * Gates diff/code editor rendering: wait for `'ready'` before rendering editors.
 *
 * Also activates FS watching for the URI's task while the component is mounted —
 * the first observer of a URI triggers onBecomeObserved which starts FS watch + polling;
 * the last observer unmounting triggers onBecomeUnobserved which stops them.
 *
 * Calling component must be wrapped with `observer()` from `mobx-react-lite`.
 *
 * @param uri — a typed URI: disk://, git://, or file:// buffer URI
 */
export function useModelStatus(uri: string): ModelStatus {
  return modelRegistry.modelStatus.get(uri) ?? 'loading';
}
