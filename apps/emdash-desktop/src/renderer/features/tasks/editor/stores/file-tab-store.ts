import { action, makeObservable, observable } from 'mobx';
import { getFileKind, isPreviewableKind } from '@renderer/lib/editor/fileKind';
import type { ManagedFileKind } from '@renderer/lib/editor/types';

/** Extends ManagedFileKind with terminal load-time states. */
export type FileContentType = ManagedFileKind | 'file-error';

/** Whether the file is shown in Monaco (source) or its rendered preview. */
export type FileViewMode = 'source' | 'preview';

/**
 * Observable store for a single open file tab.
 * Owns all file-specific display state: path, content type, view mode, image content, size.
 */
export class FileTabStore {
  readonly tabId: string;
  readonly kind = 'file' as const;

  path: string;
  isPreview: boolean;
  fileKind: ManagedFileKind;
  /** The content type of the file (derived from path; may change to 'too-large'/'file-error' after load). */
  contentType: FileContentType;
  /** Whether to show Monaco source or the rendered preview. Defaults to 'preview' for previewable kinds. */
  viewMode: FileViewMode;
  /** Data-URL for image files; empty string for Monaco-backed files. */
  content: string;
  /** True for image files while the data-URL is being fetched, or external files while content loads. */
  isLoading: boolean;
  totalSize: number | null;
  /** Read-only absolute file opened from outside the workspace. */
  isExternal: boolean;
  externalError: string | undefined;

  constructor(path: string, isPreview: boolean, tabId?: string) {
    const fileKind = getFileKind(path);
    this.tabId = tabId ?? crypto.randomUUID();
    this.path = path;
    this.isPreview = isPreview;
    this.fileKind = fileKind;
    this.contentType = fileKind;
    this.viewMode = isPreviewableKind(fileKind) ? 'preview' : 'source';
    this.content = '';
    this.isLoading = fileKind === 'image';
    this.totalSize = null;
    this.isExternal = false;
    this.externalError = undefined;

    makeObservable(this, {
      path: observable,
      isPreview: observable,
      fileKind: observable,
      contentType: observable,
      viewMode: observable,
      content: observable,
      isLoading: observable,
      totalSize: observable,
      isExternal: observable,
      externalError: observable,
      setContentType: action,
      setViewMode: action,
      setImageContent: action,
      setTotalSize: action,
      pin: action,
      resetForPath: action,
      markExternalLoading: action,
      setExternalContent: action,
      setExternalError: action,
    });
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

  pin(): void {
    this.isPreview = false;
  }

  /**
   * Mutates this entry in-place for preview-tab path replacement.
   * Keeps the same tabId so the tab bar sees an update rather than a remove+add.
   */
  resetForPath(newPath: string): void {
    const fileKind = getFileKind(newPath);
    this.path = newPath;
    this.fileKind = fileKind;
    this.contentType = fileKind;
    this.viewMode = isPreviewableKind(fileKind) ? 'preview' : 'source';
    this.content = '';
    this.isLoading = fileKind === 'image';
    this.totalSize = null;
    this.isExternal = false;
    this.externalError = undefined;
  }

  markExternalLoading(): void {
    this.isExternal = true;
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
}
