import type { HostFileRef } from '@emdash/core/primitives/path/api';
import { observable, runInAction } from 'mobx';
import type * as Monaco from 'monaco-editor';
import { openFile } from '@core/features/workbench/api/browser/open-file';
import { getTaskComposition } from '@core/features/workbench/api/browser/task-composition-selectors';
import { getEditorClient } from '../../api/browser/client';
import { openFileStore } from '../../api/browser/open-file-store/open-file-store';
import { setBeforeSaveHook } from '../../api/browser/task-editor/stores/editor-view-store';
import type { FileTabResource } from '../../api/browser/task-editor/stores/file-tab-resource';
import { MonacoLanguageServices } from './monaco-language-services';

type Registration = {
  ref: HostFileRef;
  root: HostFileRef;
  context: { projectId: string; taskId: string };
  release?: () => void;
};
const registrations = new Set<Registration>();
const instance = observable.box<MonacoLanguageServices | undefined>(undefined, { deep: false });

export function getLanguageServices(): MonacoLanguageServices | undefined {
  return instance.get();
}

/** Files the task has open in the editor, with the workspace root they resolve against. */
export function taskLanguageRefs(taskId: string): readonly Registration[] {
  return [...registrations].filter((registration) => registration.context.taskId === taskId);
}

/** Opens `ref` in the task's focused pane and selects `range` (go-to-definition, Problems). */
export function openEditorLocation(
  context: Registration['context'],
  ref: HostFileRef,
  range: Monaco.IRange
): boolean {
  if (!openFile(ref, { context, target: 'active', reveal: true })) return false;
  const resource = getTaskComposition(
    context.projectId,
    context.taskId
  )?.paneLayout.focusedPane.activeResourceOfKind<FileTabResource>('file');
  resource?.requestSelection({
    lineNumber: range.startLineNumber,
    startColumn: range.startColumn,
    endLineNumber: range.endLineNumber,
    endColumn: range.endColumn,
  });
  return true;
}

export function registerLanguageContext(
  ref: HostFileRef,
  root: HostFileRef,
  context: Registration['context']
): () => void {
  const registration: Registration = {
    ref,
    root,
    context,
    release: instance.get()?.registerContext(ref, root, context),
  };
  registrations.add(registration);
  return () => {
    registration.release?.();
    registrations.delete(registration);
  };
}

/** Called once from the lazy Monaco bootstrap; registrations may precede Monaco loading. */
export function installLanguageServices(monaco: typeof Monaco): void {
  if (instance.get()) return;
  const services = new MonacoLanguageServices(monaco, {
    client: async () => (await getEditorClient()).lsp,
    openLocation: openEditorLocation,
  });
  for (const registration of registrations)
    registration.release = services.registerContext(
      registration.ref,
      registration.root,
      registration.context
    );
  openFileStore.onDidSave(({ ref, text }) => services.documentSaved(ref, text));
  setBeforeSaveHook((ref) => services.formatBeforeSave(ref));
  runInAction(() => instance.set(services));
}
