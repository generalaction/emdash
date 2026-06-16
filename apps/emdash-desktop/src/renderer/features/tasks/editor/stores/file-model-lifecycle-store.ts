import { computed, makeObservable, observable, reaction, runInAction } from 'mobx';
import type { TabGroupManagerStore } from '@renderer/features/tasks/tabs/tab-group-manager-store';
import { getEditableBufferPath } from '@renderer/features/tasks/tabs/tab-manager-store';
import { getFileKind } from '@renderer/lib/editor/fileKind';
import { rpc } from '@renderer/lib/ipc';
import { showModal } from '@renderer/lib/modal/modal-provider';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import type { Snapshottable } from '@renderer/lib/stores/snapshottable';
import { getMonacoLanguageId } from '@renderer/utils/diffUtils';
import { log } from '@renderer/utils/logger';
import { HEAD_REF } from '@shared/core/git/git';
import type { EditorViewSnapshot } from '@shared/view-state';

/**
 * Owns Monaco model lifecycle (register/unregister) and file persistence (save, conflict).
 *
 * Replaces the model lifecycle reaction in TaskViewStore and the model-related
 * methods in EditorViewStore. Also manages the file-tree sidebar's expanded paths.
 *
 * Reactive model lifecycle: watches tabManager.openFilePaths and registers/unregisters
 * Monaco models (disk, git, buffer) accordingly. On registration results, updates the
 * corresponding FileTabStore directly (setImageContent, setTotalSize, updateRenderer).
 */
export class FileModelLifecycleStore implements Snapshottable<EditorViewSnapshot> {
  readonly modelRootPath: string;

  isSaving = false;
  /**
   * Set to the buffer URI of a file that has a conflict pending resolution.
   * EditorProvider watches this via a MobX reaction and shows the conflict modal.
   */
  pendingConflictUri: string | null = null;

  /** Persisted navigation state for the file tree sidebar. */
  expandedPaths = observable.set<string>();

  private readonly projectId: string;
  private readonly workspaceId: string;
  private readonly tabGroupManager: TabGroupManagerStore;
  private readonly disposers: (() => void)[] = [];

  constructor(tabGroupManager: TabGroupManagerStore, projectId: string, workspaceId: string) {
    this.tabGroupManager = tabGroupManager;
    this.projectId = projectId;
    this.workspaceId = workspaceId;
    this.modelRootPath = `workspace:${workspaceId}`;

    makeObservable(this, {
      isSaving: observable,
      pendingConflictUri: observable,
      openFilePaths: computed,
      snapshot: computed,
    });

    // Reactive model lifecycle: register/unregister Monaco models as editable tabs open/close
    // across ALL panes. This includes file tabs and working-tree diff tabs so unsaved diff
    // edits survive renderer unmounts when users switch tabs. A model stays registered as
    // long as any pane has the editable path open.
    this.disposers.push(
      reaction(
        () => this.tabGroupManager.allOpenEditablePaths,
        (current, previous = []) => {
          const prev = new Set(previous);
          const curr = new Set(current);
          for (const path of curr) {
            if (!prev.has(path)) {
              void this._registerModels(path);
            }
          }
          for (const path of prev) {
            if (!curr.has(path)) this._unregisterModels(path);
          }
        },
        { fireImmediately: true }
      )
    );

    // Register as the close coordinator for all panes. For dirty file tabs this
    // shows the unsaved-changes dialog before proceeding. All other tab kinds
    // and clean file tabs close immediately. The handler is propagated to all
    // current and future groups via TabGroupManagerStore.
    tabGroupManager.registerCloseHandler(async (tabId) => {
      // Find which group owns this tab.
      for (const { tabManager } of tabGroupManager.groups) {
        const entry = tabManager.entries.get(tabId);
        if (entry !== undefined) {
          const editablePath = getEditableBufferPath(entry);
          if (editablePath) {
            const uri = buildMonacoModelPath(this.modelRootPath, editablePath);
            if (modelRegistry.isDirty(uri)) {
              const result = await this._confirmClose(editablePath);
              if (result === 'cancel') return;
            }
          }
          tabManager.closeTab(tabId);
          return;
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Computed
  // ---------------------------------------------------------------------------

  /** Union of all open file paths across all panes (deduplicated). */
  get openFilePaths(): string[] {
    return this.tabGroupManager.allOpenFilePaths;
  }

  // ---------------------------------------------------------------------------
  // Snapshottable
  // ---------------------------------------------------------------------------

  get snapshot(): EditorViewSnapshot {
    return {
      expandedPaths: [...this.expandedPaths],
    };
  }

  restoreSnapshot(snapshot: Partial<EditorViewSnapshot>): void {
    if (snapshot.expandedPaths) {
      this.expandedPaths.replace(snapshot.expandedPaths);
    }
  }

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

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
        log.error('[FileModelLifecycleStore] Failed to save file:', filePath);
      }
    } catch (error) {
      log.error('[FileModelLifecycleStore] Error saving file:', error);
    } finally {
      runInAction(() => {
        this.isSaving = false;
      });
    }
  }

  async saveAllFiles(): Promise<void> {
    const dirtyPaths = this.tabGroupManager.allOpenEditablePaths.filter((path) =>
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
      const filePath = uri.replace(`file://${this.modelRootPath}/`, '');
      void rpc.workspace.editor.clearBuffer(this.projectId, this.workspaceId, filePath);
    } else {
      runInAction(() => {
        this.isSaving = true;
      });
      try {
        await modelRegistry.saveFileToDisk(uri);
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
      const buffers = await rpc.workspace.editor.listBuffers(this.projectId, this.workspaceId);
      for (const { filePath, content } of buffers) {
        const uri = buildMonacoModelPath(this.modelRootPath, filePath);
        const model = modelRegistry.getModelByUri(uri);
        if (model) model.setValue(content);
      }
    } catch (e) {
      log.warn('[FileModelLifecycleStore] Failed to restore buffers:', e);
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  dispose(): void {
    for (const d of this.disposers) d();
  }

  // ---------------------------------------------------------------------------
  // Private — close guard
  // ---------------------------------------------------------------------------

  private _confirmClose(path: string): Promise<'proceed' | 'cancel'> {
    const fileName = path.split('/').pop() ?? path;
    return new Promise((resolve) =>
      showModal('unsavedChangesModal', {
        fileName,
        onSuccess: (result) => {
          const savePromise = result === 'save' ? this.saveFile(path) : Promise.resolve();
          void savePromise.then(() => resolve('proceed'));
        },
        onClose: () => resolve('cancel'),
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Private — model registration
  // ---------------------------------------------------------------------------

  private async _registerModels(filePath: string): Promise<void> {
    const kind = getFileKind(filePath);

    if (kind === 'image') {
      const result = await rpc.workspace.fs.readImage(this.projectId, this.workspaceId, filePath);
      const imageContent = result.success ? (result.data?.dataUrl ?? '') : '';
      runInAction(() => {
        for (const { tabManager } of this.tabGroupManager.groups) {
          tabManager.setImageContent(filePath, imageContent);
        }
      });
      return;
    }

    if (kind === 'text' || kind === 'markdown' || kind === 'svg' || kind === 'html') {
      const language = getMonacoLanguageId(filePath);
      try {
        await modelRegistry.registerModel(
          this.projectId,
          this.workspaceId,
          this.modelRootPath,
          filePath,
          language,
          'disk'
        );
      } catch {
        runInAction(() => {
          for (const { tabManager } of this.tabGroupManager.groups) {
            tabManager.updateRenderer(filePath, () => ({ kind: 'file-error' as const }));
          }
        });
        return;
      }

      const bufferUri = buildMonacoModelPath(this.modelRootPath, filePath);
      const diskUri = modelRegistry.toDiskUri(bufferUri);
      if (modelRegistry.modelStatus.get(diskUri) === 'too-large') {
        const totalSize = modelRegistry.modelTotalSizes.get(diskUri);
        runInAction(() => {
          for (const { tabManager } of this.tabGroupManager.groups) {
            tabManager.updateRenderer(filePath, () => ({ kind: 'too-large' as const }));
            if (totalSize != null) tabManager.setFileTotalSize(filePath, totalSize);
          }
        });
        return;
      }

      await modelRegistry.registerModel(
        this.projectId,
        this.workspaceId,
        this.modelRootPath,
        filePath,
        language,
        'git'
      );
      await modelRegistry.registerModel(
        this.projectId,
        this.workspaceId,
        this.modelRootPath,
        filePath,
        language,
        'buffer'
      );
    }
  }

  private _unregisterModels(filePath: string): void {
    const uri = buildMonacoModelPath(this.modelRootPath, filePath);
    modelRegistry.unregisterModel(uri);
    modelRegistry.unregisterModel(modelRegistry.toDiskUri(uri));
    modelRegistry.unregisterModel(modelRegistry.toGitUri(uri, HEAD_REF));

    if (!this._hasOpenEditableTabForPath(filePath)) {
      void rpc.workspace.editor.clearBuffer(this.projectId, this.workspaceId, filePath);
    }
  }

  private _hasOpenEditableTabForPath(filePath: string): boolean {
    for (const { tabManager } of this.tabGroupManager.groups) {
      for (const entry of tabManager.entries.values()) {
        if (getEditableBufferPath(entry) === filePath) {
          return true;
        }
      }
    }
    return false;
  }
}
