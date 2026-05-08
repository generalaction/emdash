import { action, makeObservable, observable } from 'mobx';
import type { FileRendererData } from '@renderer/features/tasks/types';
import { getFileKind } from '@renderer/lib/editor/fileKind';
import { getDefaultRenderer } from '@renderer/lib/editor/renderer-utils';
import type { ManagedFileKind } from '@renderer/lib/editor/types';

/**
 * Observable store for a single open file tab.
 * Owns all file-specific display state: path, renderer kind, image content, size.
 */
export class FileTabStore {
  readonly tabId: string;
  readonly kind = 'file' as const;

  path: string;
  isPreview: boolean;
  fileKind: ManagedFileKind;
  renderer: FileRendererData;
  /** Data-URL for image files; empty string for Monaco-backed files. */
  content: string;
  /** True only for image files while the data-URL is being fetched. */
  isLoading: boolean;
  totalSize: number | null;

  constructor(path: string, isPreview: boolean, tabId?: string) {
    const fileKind = getFileKind(path);
    this.tabId = tabId ?? crypto.randomUUID();
    this.path = path;
    this.isPreview = isPreview;
    this.fileKind = fileKind;
    this.renderer = getDefaultRenderer(fileKind);
    this.content = '';
    this.isLoading = fileKind === 'image';
    this.totalSize = null;

    makeObservable(this, {
      path: observable,
      isPreview: observable,
      fileKind: observable,
      renderer: observable,
      content: observable,
      isLoading: observable,
      totalSize: observable,
      updateRenderer: action,
      setImageContent: action,
      setTotalSize: action,
      pin: action,
      resetForPath: action,
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
    this.isLoading = fileKind === 'image';
    this.totalSize = null;
  }
}
