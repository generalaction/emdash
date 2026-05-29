import { action, makeObservable, observable } from 'mobx';
import type { FileRendererData } from '@renderer/features/tasks/types';
import { getFileKind } from '@renderer/lib/editor/fileKind';
import { getDefaultRenderer } from '@renderer/lib/editor/renderer-utils';
import type { ManagedFileKind } from '@renderer/lib/editor/types';

/**
 * Observable store for a single open file tab.
 * Owns all file-specific display state: path, renderer kind, preview content, size.
 */
export class FileTabStore {
  readonly tabId: string;
  readonly kind = 'file' as const;

  path: string;
  isPreview: boolean;
  fileKind: ManagedFileKind;
  renderer: FileRendererData;
  /** Data-URL for binary previews; empty string for Monaco-backed files. */
  content: string;
  /** True while preview content is being fetched, or external files while content loads. */
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
    this.renderer = getDefaultRenderer(fileKind);
    this.content = '';
    this.isLoading = fileKind === 'image' || fileKind === 'pdf';
    this.totalSize = null;
    this.isExternal = false;
    this.externalError = undefined;

    makeObservable(this, {
      path: observable,
      isPreview: observable,
      fileKind: observable,
      renderer: observable,
      content: observable,
      isLoading: observable,
      totalSize: observable,
      isExternal: observable,
      externalError: observable,
      updateRenderer: action,
      setImageContent: action,
      setTotalSize: action,
      pin: action,
      resetForPath: action,
      markExternalLoading: action,
      setExternalContent: action,
      setExternalError: action,
    });
  }

  updateRenderer(updater: (prev: FileRendererData) => FileRendererData): void {
    this.renderer = updater(this.renderer);
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
    this.renderer = getDefaultRenderer(fileKind);
    this.content = '';
    this.isLoading = fileKind === 'image' || fileKind === 'pdf';
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
