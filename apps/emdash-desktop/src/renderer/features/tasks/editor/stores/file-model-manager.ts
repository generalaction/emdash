import { runInAction } from 'mobx';
import { getFileKind, isMonacoBackedKind } from '@renderer/lib/editor/fileKind';
import { rpc } from '@renderer/lib/ipc';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { getMonacoLanguageId } from '@renderer/utils/diffUtils';
import { HEAD_REF } from '@shared/core/git/types';
import type { FileTabResource } from './file-tab-resource';

/**
 * Context needed to register Monaco models for a file.
 * Mirrors the fields available in TaskTabContext.
 */
export interface FileModelContext {
  projectId: string;
  workspaceId: string;
  modelRootPath: string;
}

type ResourceSet = Set<FileTabResource>;

type EntryState =
  | { status: 'pending'; resources: ResourceSet }
  | { status: 'image'; dataUrl: string; resources: ResourceSet }
  | { status: 'too-large'; totalSize: number; resources: ResourceSet }
  | { status: 'error'; resources: ResourceSet }
  | { status: 'ready'; resources: ResourceSet };

/**
 * Per-workspace ref-counted manager for Monaco model lifecycles.
 *
 * Replaces the union-of-paths reaction that previously lived in EditorViewStore.
 *
 * `acquire(path, resource, ctx)`:
 *   - First caller: triggers async Monaco model registration.
 *   - Subsequent callers: immediately notifies the new resource with the
 *     current registration state (so multi-pane same-file tabs get their UI updated).
 *
 * `release(path, resource)`:
 *   - Removes the resource from the notification set.
 *   - When no resources remain, unregisters Monaco models.
 *
 * Save/conflict/restore remain in FileModelLifecycleStore (not tab-owned).
 */
export class FileModelManager {
  private readonly _entries = new Map<string, EntryState>();
  private readonly _ctx: FileModelContext;

  constructor(ctx: FileModelContext) {
    this._ctx = ctx;
  }

  /**
   * Register interest in the Monaco models for `path` from `resource`.
   * If models are already registered, notifies `resource` immediately.
   * If this is the first acquire for `path`, starts async model registration.
   */
  acquire(path: string, resource: FileTabResource): void {
    const existing = this._entries.get(path);
    if (existing) {
      existing.resources.add(resource);
      // Notify the new resource of current state (if registration has settled).
      this._applyState(resource, existing);
      return;
    }

    // First retain — start registration.
    const entry: EntryState = { status: 'pending', resources: new Set([resource]) };
    this._entries.set(path, entry);
    void this._registerModels(path);
  }

  /**
   * Deregister interest in the Monaco models for `path` from `resource`.
   * When no resources remain for `path`, unregisters the Monaco models.
   */
  release(path: string, resource: FileTabResource): void {
    const entry = this._entries.get(path);
    if (!entry) return;
    entry.resources.delete(resource);
    if (entry.resources.size > 0) return;

    // Last release — tear down Monaco models.
    this._entries.delete(path);
    this._unregisterModels(path);
  }

  dispose(): void {
    for (const path of this._entries.keys()) {
      this._unregisterModels(path);
    }
    this._entries.clear();
  }

  private async _registerModels(path: string): Promise<void> {
    const kind = getFileKind(path);

    if (kind === 'image' || kind === 'svg') {
      const result = await rpc.workspace.fs.readImage(
        this._ctx.projectId,
        this._ctx.workspaceId,
        path
      );
      const dataUrl = result.success ? (result.data?.dataUrl ?? '') : '';
      runInAction(() => {
        const entry = this._entries.get(path);
        if (!entry) return;
        const newState: EntryState = { status: 'image', dataUrl, resources: entry.resources };
        this._entries.set(path, newState);
        for (const res of entry.resources) {
          this._applyState(res, newState);
        }
      });
      return;
    }

    if (isMonacoBackedKind(kind)) {
      const language = getMonacoLanguageId(path);

      try {
        await modelRegistry.registerModel(
          this._ctx.projectId,
          this._ctx.workspaceId,
          this._ctx.modelRootPath,
          path,
          language,
          'disk'
        );
      } catch {
        runInAction(() => {
          const entry = this._entries.get(path);
          if (!entry) return;
          const newState: EntryState = { status: 'error', resources: entry.resources };
          this._entries.set(path, newState);
          for (const res of entry.resources) {
            this._applyState(res, newState);
          }
        });
        return;
      }

      const bufferUri = buildMonacoModelPath(this._ctx.modelRootPath, path);
      const diskUri = modelRegistry.toDiskUri(bufferUri);
      if (modelRegistry.modelStatus.get(diskUri) === 'too-large') {
        const totalSize = modelRegistry.modelTotalSizes.get(diskUri) ?? 0;
        runInAction(() => {
          const entry = this._entries.get(path);
          if (!entry) return;
          const newState: EntryState = {
            status: 'too-large',
            totalSize,
            resources: entry.resources,
          };
          this._entries.set(path, newState);
          for (const res of entry.resources) {
            this._applyState(res, newState);
          }
        });
        return;
      }

      await modelRegistry.registerModel(
        this._ctx.projectId,
        this._ctx.workspaceId,
        this._ctx.modelRootPath,
        path,
        language,
        'git'
      );
      await modelRegistry.registerModel(
        this._ctx.projectId,
        this._ctx.workspaceId,
        this._ctx.modelRootPath,
        path,
        language,
        'buffer'
      );

      runInAction(() => {
        const entry = this._entries.get(path);
        if (!entry) return;
        const newState: EntryState = { status: 'ready', resources: entry.resources };
        this._entries.set(path, newState);
        for (const res of entry.resources) {
          this._applyState(res, newState);
        }
      });
      return;
    }

    // Non-Monaco, non-image (e.g. binary, PDF): treat as ready without model.
    runInAction(() => {
      const entry = this._entries.get(path);
      if (!entry) return;
      const newState: EntryState = { status: 'ready', resources: entry.resources };
      this._entries.set(path, newState);
      for (const res of entry.resources) {
        this._applyState(res, newState);
      }
    });
  }

  private _unregisterModels(path: string): void {
    const uri = buildMonacoModelPath(this._ctx.modelRootPath, path);
    modelRegistry.unregisterModel(uri);
    modelRegistry.unregisterModel(modelRegistry.toDiskUri(uri));
    modelRegistry.unregisterModel(modelRegistry.toGitUri(uri, HEAD_REF));
    void rpc.workspace.editor.clearBuffer(this._ctx.projectId, this._ctx.workspaceId, path);
  }

  private _applyState(resource: FileTabResource, state: EntryState): void {
    switch (state.status) {
      case 'image':
        resource.setImageContent(state.dataUrl);
        break;
      case 'too-large':
        resource.setContentType('too-large');
        resource.setTotalSize(state.totalSize);
        break;
      case 'error':
        resource.setContentType('file-error');
        break;
      case 'pending':
      case 'ready':
        // Nothing to set yet; resource stays in default state.
        break;
    }
  }
}

const _registry = new Map<string, FileModelManager>();

export function getFileModelManager(workspaceId: string, ctx: FileModelContext): FileModelManager {
  const existing = _registry.get(workspaceId);
  if (existing) return existing;
  const manager = new FileModelManager(ctx);
  _registry.set(workspaceId, manager);
  return manager;
}

export function releaseFileModelManager(workspaceId: string): void {
  const manager = _registry.get(workspaceId);
  if (!manager) return;
  manager.dispose();
  _registry.delete(workspaceId);
}
