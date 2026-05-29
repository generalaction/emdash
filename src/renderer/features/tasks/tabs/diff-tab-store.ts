import { action, makeObservable, observable } from 'mobx';
import type { DiffRendererData } from '@renderer/features/tasks/types';
import { getFileKind } from '@renderer/lib/editor/fileKind';
import type { GitChangeStatus, GitObjectRef } from '@shared/git';
import type { ActiveFile } from '@shared/view-state';

/**
 * Observable store for a single open diff tab.
 * Owns all diff-specific state: path, diffGroup, refs, git change status.
 */
export class DiffTabStore {
  readonly tabId: string;
  readonly kind = 'diff' as const;

  path: string;
  isPreview: boolean;
  renderer: DiffRendererData;
  diffGroup: 'disk' | 'staged' | 'git' | 'pr';
  originalRef: GitObjectRef;
  modifiedRef: GitObjectRef | undefined;
  prNumber: number | undefined;
  status: GitChangeStatus | undefined;

  constructor(
    activeFile: ActiveFile,
    isPreview: boolean,
    tabId?: string,
    status?: GitChangeStatus
  ) {
    this.tabId = tabId ?? crypto.randomUUID();
    this.path = activeFile.path;
    this.isPreview = isPreview;
    this.renderer = resolveDiffRenderer(activeFile.path);
    this.diffGroup = activeFile.group;
    this.originalRef = activeFile.originalRef;
    this.modifiedRef = activeFile.modifiedRef;
    this.prNumber = activeFile.prNumber;
    this.status = status;

    makeObservable(this, {
      isPreview: observable,
      renderer: observable,
      diffGroup: observable,
      originalRef: observable,
      modifiedRef: observable,
      prNumber: observable,
      status: observable,
      transition: action,
      pin: action,
    });
  }

  /**
   * Transitions this diff tab between 'disk' and 'staged' groups in-place,
   * preserving tab identity and position. Used when a file moves between
   * the staged/unstaged lists while its diff tab is open.
   */
  transition(
    newGroup: 'disk' | 'staged',
    newOriginalRef: GitObjectRef,
    status?: GitChangeStatus
  ): void {
    this.diffGroup = newGroup;
    this.originalRef = newOriginalRef;
    this.modifiedRef = undefined;
    this.prNumber = undefined;
    this.status = status;
  }

  pin(): void {
    this.isPreview = false;
  }
}

function resolveDiffRenderer(path: string): DiffRendererData {
  const kind = getFileKind(path);
  if (kind === 'image' || kind === 'svg') return { kind: 'image' };
  if (kind === 'pdf') return { kind: 'pdf' };
  if (kind === 'binary') return { kind: 'binary' };
  return { kind: 'text' };
}
