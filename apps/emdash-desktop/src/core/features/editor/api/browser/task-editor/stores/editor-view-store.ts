import {
  decodeResourceUri,
  encodeResourceUri,
  relativizeHostFileRef,
} from '@emdash/core/primitives/path/api';
import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import { getEditorClient } from '@core/features/editor/api/browser/client';
import { modelRegistry } from '@core/features/editor/api/browser/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@core/features/editor/api/browser/monaco/monacoModelPath';
import type {
  FilePayload,
  FileTabResource,
} from '@core/features/editor/api/browser/task-editor/stores/file-tab-resource';
import type { TaskEditorTreeState } from '@core/features/tasks/contributions/mementos';
import { log } from '@core/primitives/logging/browser/logger';
import type { MementoHandle } from '@core/primitives/mementos/browser';
import type { PaneLayoutStore } from '@core/primitives/workbench-shell/browser/tabs/pane-layout-store';
import { allOpenFileResources } from '../../../../browser/task-editor/pane-selectors';
import { FilesStore } from '../../../../browser/task-editor/stores/files-store';

/**
 * Manages file persistence (save, conflict resolution) and sidebar navigation state.
 *
 * Monaco model lifecycle (retain/release) is now handled by FileModelManager,
 * which is called by FileTabResource on construction and dispose.
 * This store focuses on save-all, conflict resolution, and buffer restore.
 */
export class EditorViewStore {
  readonly modelRootPath: string;

  isSaving = false;
  /**
   * Set to the buffer URI of a file that has a conflict pending resolution.
   * EditorProvider watches this via a MobX reaction and shows the conflict modal.
   */
  pendingConflictUri: string | null = null;

  /** Monotonic signal used by the task-level search command to focus the sidebar input. */
  fileSearchFocusRequest = 0;

  /** Monotonic signal consumed by the file tree adapter to reveal a path in the sidebar. */
  revealFileRequest: { path: string; counter: number } = { path: '', counter: 0 };

  /**
   * Per-view file-tree projection store. Created when the task session starts (`startFiles`) and
   * torn down on suspend (`disposeFiles`), so projection state lives with this view's expansion
   * state rather than being shared across all tasks on the same workspace.
   */
  files: FilesStore | null = null;

  private readonly projectId: string;
  private readonly workspaceId: string;
  private readonly paneLayout: PaneLayoutStore;

  constructor(
    paneLayout: PaneLayoutStore,
    projectId: string,
    workspaceId: string,
    private readonly treeHandle: MementoHandle<TaskEditorTreeState>
  ) {
    this.paneLayout = paneLayout;
    this.projectId = projectId;
    this.workspaceId = workspaceId;
    this.modelRootPath = `workspace:${workspaceId}`;

    makeObservable<EditorViewStore, 'treeHandle'>(this, {
      isSaving: observable,
      pendingConflictUri: observable,
      fileSearchFocusRequest: observable,
      revealFileRequest: observable.struct,
      files: observable.ref,
      expandedPaths: computed.struct,
      requestFileSearchFocus: action,
      requestRevealFile: action,
      treeHandle: false,
    });
  }

  get expandedPaths(): Set<string> {
    return new Set(this.treeHandle.value.expandedPaths);
  }

  requestFileSearchFocus(): void {
    this.fileSearchFocusRequest += 1;
  }

  requestRevealFile(path: string): void {
    this.revealFileRequest = {
      path,
      counter: this.revealFileRequest.counter + 1,
    };
  }

  /** Opens the per-view file-tree projection. Idempotent. */
  startFiles(workspacePath: string): void {
    if (this.files) return;
    const store = new FilesStore(this.projectId, this.workspaceId, workspacePath);
    runInAction(() => {
      this.files = store;
    });
    void store.start();
  }

  /** Closes the projection subscription and clears the per-view tree state. */
  disposeFiles(): void {
    const store = this.files;
    runInAction(() => {
      this.files = null;
    });
    store?.dispose();
  }

  /** Union of all open file resources across all panes. */
  get openFileResources(): FileTabResource[] {
    return allOpenFileResources(this.paneLayout);
  }

  /** Union of all open non-external file paths across all panes (deduplicated). */
  get openFilePaths(): string[] {
    const seen = new Set<string>();
    for (const r of this.openFileResources) {
      if (!r.isExternal) seen.add(r.path);
    }
    return [...seen];
  }

  expandPath(path: string): void {
    this.expandPaths([path]);
  }

  expandPaths(paths: readonly string[]): void {
    this.treeHandle.update((current) => ({
      ...current,
      expandedPaths: [...new Set([...current.expandedPaths, ...paths])],
    }));
  }

  collapsePath(path: string): void {
    this.collapsePaths([path]);
  }

  collapsePaths(paths: readonly string[]): void {
    const removed = new Set(paths);
    this.treeHandle.update((current) => ({
      ...current,
      expandedPaths: current.expandedPaths.filter((candidate) => !removed.has(candidate)),
    }));
  }

  async retargetOpenFiles(oldPath: string, newPath: string): Promise<void> {
    const normalizedOld = normalizeTreePath(oldPath);
    const normalizedNew = normalizeTreePath(newPath);
    const retargets: Array<() => void> = [];
    const cancelBufferTransfers: Array<() => void> = [];

    try {
      for (const { pane } of this.paneLayout.groups) {
        for (const tab of pane.resolvedTabs) {
          if (tab.kind !== 'file') continue;
          const resource = tab.resource as FileTabResource;
          if (resource.isExternal || !isPathAffected(resource.path, normalizedOld)) continue;
          const rewritten = rewriteAffectedPath(resource.path, normalizedOld, normalizedNew);
          const cancelTransfer = await modelRegistry.transferBufferState(
            buildMonacoModelPath(this.modelRootPath, resource.path),
            buildMonacoModelPath(this.modelRootPath, rewritten),
            rewritten
          );
          cancelBufferTransfers.push(cancelTransfer);
          retargets.push(() => {
            pane.retargetEntry(tab.tabId, {
              state: { path: rewritten, isExternal: false } satisfies FilePayload,
            });
          });
        }
      }
    } catch (error) {
      for (const cancel of cancelBufferTransfers) cancel();
      throw error;
    }

    for (const retarget of retargets) retarget();
    this.retargetExpandedPaths(normalizedOld, normalizedNew);
  }

  async saveFile(filePath: string): Promise<void> {
    const uri = buildMonacoModelPath(this.modelRootPath, filePath);
    if (!modelRegistry.isDirty(uri)) return;

    if (modelRegistry.hasPendingConflict(uri)) {
      runInAction(() => {
        this.pendingConflictUri = uri;
      });
      return;
    }

    runInAction(() => {
      this.isSaving = true;
    });
    try {
      const result = await modelRegistry.saveFileToDisk(uri);
      if (result === null) {
        if (modelRegistry.hasPendingConflict(uri)) {
          runInAction(() => {
            this.pendingConflictUri = uri;
          });
        }
        log.error('[EditorViewStore] Failed to save file:', filePath);
      }
    } catch (error) {
      log.error('[EditorViewStore] Error saving file:', error);
    } finally {
      runInAction(() => {
        this.isSaving = false;
      });
    }
  }

  async saveAllFiles(): Promise<void> {
    const dirtyPaths = this.openFilePaths.filter((path) =>
      modelRegistry.isDirty(buildMonacoModelPath(this.modelRootPath, path))
    );
    for (const path of dirtyPaths) {
      await this.saveFile(path);
    }
  }

  /**
   * Resolves a pending conflict: either reloads buffer from disk ("Accept Incoming")
   * or writes the user's buffer to disk ("Keep Mine").
   */
  async resolveConflict(accept: boolean): Promise<void> {
    const uri = this.pendingConflictUri;
    if (!uri) return;
    runInAction(() => {
      this.pendingConflictUri = null;
    });

    if (accept) {
      modelRegistry.reloadFromDisk(uri);
      const key = modelRegistry.resourceUriForBuffer(uri);
      if (key) {
        void getEditorClient().then((client) => client.clearBuffer({ uri: key }));
      }
    } else {
      runInAction(() => {
        this.isSaving = true;
      });
      try {
        await modelRegistry.saveFileToDisk(uri, { overwrite: true });
      } finally {
        runInAction(() => {
          this.isSaving = false;
        });
      }
    }
  }

  /**
   * Restores crash-recovery buffer content for any open tabs whose models are
   * already registered. Called by EditorProvider on mount. Buffers are keyed by
   * ResourceUri, so persisted keys under the workspace root are mapped back to
   * workspace-relative paths to locate the Monaco models.
   */
  async restoreBuffers(): Promise<void> {
    const rootRef = modelRegistry.workspaceRootFileRef(this.workspaceId);
    if (!rootRef) return;
    try {
      const buffers = await (
        await getEditorClient()
      ).listBuffers({ root: encodeResourceUri(rootRef) });
      for (const { uri: bufferKey, content } of buffers) {
        const decoded = decodeResourceUri(bufferKey);
        if (!decoded.success) continue;
        const relative = relativizeHostFileRef(rootRef, decoded.data);
        if (!relative.success) continue;
        const uri = buildMonacoModelPath(this.modelRootPath, relative.data);
        const model = modelRegistry.getModelByUri(uri);
        if (model) model.setValue(content);
      }
    } catch (e) {
      log.warn('[EditorViewStore] Failed to restore buffers:', e);
    }
  }

  dispose(): void {
    this.disposeFiles();
  }

  private retargetExpandedPaths(oldPath: string, newPath: string): void {
    this.treeHandle.update((current) => ({
      ...current,
      expandedPaths: [
        ...new Set(
          current.expandedPaths.map((candidate) =>
            isPathAffected(candidate, oldPath)
              ? rewriteAffectedPath(candidate, oldPath, newPath)
              : candidate
          )
        ),
      ],
    }));
  }
}

function normalizeTreePath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/\/+/g, '/');
  if (normalized.length > 1 && normalized.endsWith('/')) return normalized.slice(0, -1);
  return normalized;
}

function isPathAffected(candidate: string, oldPath: string): boolean {
  const normalized = normalizeTreePath(candidate);
  return normalized === oldPath || normalized.startsWith(`${oldPath}/`);
}

function rewriteAffectedPath(candidate: string, oldPath: string, newPath: string): string {
  const normalized = normalizeTreePath(candidate);
  if (normalized === oldPath) return newPath;
  return `${newPath}${normalized.slice(oldPath.length)}`;
}
