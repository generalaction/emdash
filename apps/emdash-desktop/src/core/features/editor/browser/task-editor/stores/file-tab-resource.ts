import { action, makeObservable, observable } from 'mobx';
import type {
  TabHandle,
  TabResource,
} from '@core/features/workbench/browser/tabs/core/tab-provider';
import { modelRegistry } from '../../monaco/monaco-model-registry';
import { buildMonacoModelPath } from '../../monaco/monacoModelPath';
import { getFileKind, isPreviewableKind } from '../../renderers/fileKind';
import type { ManagedFileKind } from '../../renderers/types';
import type { FileModelContext, FileModelManager } from './file-model-manager';

/** Extends ManagedFileKind with terminal load-time states. */
export type FileContentType = ManagedFileKind | 'file-error' | 'too-large';

/** Whether the file is shown in Monaco (source) or its rendered preview. */
export type FileViewMode = 'source' | 'preview';

export interface FilePayload {
  path: string;
  isExternal?: boolean;
}

export type FileSelection = Readonly<{
  lineNumber: number;
  startColumn: number;
  endColumn: number;
}>;

export type FileSelectionRequest = Readonly<{
  id: number;
  selection: FileSelection;
}>;

/**
 * Domain resource for a single open file tab.
 *
 * Holds all file-specific display state: content type, view mode, image content,
 * size, and external-file error.
 *
 * Replaces FileTabStore. The identity fields (tabId, kind, isPreview) live on
 * TabEntry; this class holds only the live/mutable view-model state.
 */
export class FileTabResource implements TabResource {
  readonly path: string;
  readonly isExternal: boolean;
  fileKind: ManagedFileKind;
  contentType: FileContentType;
  viewMode: FileViewMode;
  content: string;
  isLoading: boolean;
  totalSize: number | null;
  externalError: string | undefined;
  selectionRequest: FileSelectionRequest | null = null;

  private nextSelectionRequestId = 1;

  private readonly _modelManager: FileModelManager | null;
  private readonly _modelCtx: FileModelContext | null;
  private readonly _handle: TabHandle | null;

  constructor(
    payload: FilePayload,
    modelManager?: FileModelManager,
    modelCtx?: FileModelContext,
    handle?: TabHandle
  ) {
    const fileKind = getFileKind(payload.path);
    this.path = payload.path;
    this.isExternal = payload.isExternal ?? false;
    this.fileKind = fileKind;
    this.contentType = fileKind;
    this.viewMode = isPreviewableKind(fileKind) ? 'preview' : 'source';
    this.content = '';
    this.isLoading = this.isExternal || fileKind === 'image';
    this.totalSize = null;
    this.externalError = undefined;

    this._modelManager = modelManager ?? null;
    this._modelCtx = modelCtx ?? null;
    this._handle = handle ?? null;

    makeObservable(this, {
      fileKind: observable,
      contentType: observable,
      viewMode: observable,
      content: observable,
      isLoading: observable,
      totalSize: observable,
      externalError: observable,
      selectionRequest: observable.ref,
      setContentType: action,
      setViewMode: action,
      setImageContent: action,
      setTotalSize: action,
      markExternalLoading: action,
      setExternalContent: action,
      setExternalError: action,
      requestSelection: action,
      consumeSelectionRequest: action,
    });

    // Retain Monaco models for this file. Not done for external files.
    if (!this.isExternal && modelManager) {
      modelManager.acquire(this.path, this);
    }
  }

  dispose(): void {
    if (!this.isExternal && this._modelManager) {
      this._modelManager.release(this.path, this);
    }
  }

  onActivate?(): void {
    // No-op; file tabs don't need activation side-effects.
  }

  /** True when the Monaco buffer for this file has unsaved changes. */
  get isDirty(): boolean {
    if (this.isExternal || !this._modelCtx) return false;
    const uri = buildMonacoModelPath(this._modelCtx.modelRootPath, this.path);
    return modelRegistry.dirtyUris.has(uri);
  }

  /** The Monaco buffer URI for this file (empty for external files). */
  get bufferUri(): string {
    if (this.isExternal || !this._modelCtx) return '';
    return buildMonacoModelPath(this._modelCtx.modelRootPath, this.path);
  }

  /** Called by the Monaco editor when the user makes the first edit — pins the tab. */
  onFirstEdit(): void {
    this._handle?.pin();
  }

  setContentType(contentType: FileContentType): void {
    this.contentType = contentType;
  }

  setViewMode(viewMode: FileViewMode): void {
    this.viewMode = viewMode;
  }

  setImageContent(content: string): void {
    this.content = content;
    this.isLoading = false;
  }

  setTotalSize(size: number): void {
    this.totalSize = size;
  }

  markExternalLoading(): void {
    this.isLoading = true;
    this.content = '';
    this.externalError = undefined;
  }

  setExternalContent(content: string): void {
    this.content = content;
    this.isLoading = false;
    this.externalError = undefined;
  }

  setExternalError(error: string): void {
    this.content = '';
    this.isLoading = false;
    this.externalError = error;
  }

  requestSelection(selection: FileSelection): void {
    this.viewMode = 'source';
    this.selectionRequest = {
      id: this.nextSelectionRequestId,
      selection,
    };
    this.nextSelectionRequestId += 1;
  }

  consumeSelectionRequest(id: number): void {
    if (this.selectionRequest?.id === id) this.selectionRequest = null;
  }
}
