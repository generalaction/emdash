import { computed, makeObservable, observable, runInAction } from 'mobx';
import type { TaskEditorTreeState } from '@core/features/tasks/contributions/mementos';
import type { PaneLayoutStore } from '@core/features/workbench/browser/tabs/pane-layout-store';
import type { MementoHandle } from '@core/primitives/mementos/browser';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { log } from '@renderer/utils/logger';
import { allOpenFileResources } from '../pane-selectors';
import type { FileTabResource } from './file-tab-resource';
import { FilesStore } from './files-store';

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
      files: observable.ref,
      expandedPaths: computed.struct,
      treeHandle: false,
    });
  }

  get expandedPaths(): Set<string> {
    return new Set(this.treeHandle.value.expandedPaths);
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
      const filePath = modelRegistry.filePathForUri(uri);
      if (filePath) {
        void getDesktopWireClient().then((client) =>
          client.editor.clearBuffer({
            projectId: this.projectId,
            workspaceId: this.workspaceId,
            filePath,
          })
        );
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
   * already registered. Called by EditorProvider on mount.
   */
  async restoreBuffers(): Promise<void> {
    try {
      const buffers = await (
        await getDesktopWireClient()
      ).editor.listBuffers({
        projectId: this.projectId,
        workspaceId: this.workspaceId,
      });
      for (const { filePath, content } of buffers) {
        const uri = buildMonacoModelPath(this.modelRootPath, filePath);
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
}
