import type { GitChangeStatus, GitObjectRef } from '@emdash/core/git';
import { action, makeObservable, observable } from 'mobx';
import type { TabResource } from '@renderer/features/tabs/core/tab-provider';
import { getFileKind } from '@renderer/lib/editor/fileKind';
import type { ActiveFile } from '@shared/view-state';

export type DiffRendererData = { kind: 'text' } | { kind: 'image' } | { kind: 'binary' };

export interface DiffPayload {
  path: string;
  diffGroup: 'disk' | 'staged' | 'git' | 'pr';
  originalRef: GitObjectRef;
  modifiedRef?: GitObjectRef;
  prNumber?: number;
  prBaseOid?: string;
  prHeadOid?: string;
  commitOriginalSha?: string | null;
  commitModifiedSha?: string;
  status?: GitChangeStatus;
}

/**
 * Domain resource for a single open diff tab.
 *
 * Replaces DiffTabStore. The identity fields (tabId, kind, isPreview) live on
 * TabEntry; this class holds only the live/mutable diff state.
 *
 * Holds tabId so that DiffTabLifecycleStore can call pane.closeTab(resource.tabId).
 */
export class DiffTabResource implements TabResource {
  /** Provided so lifecycle stores can close/transition by tabId. */
  readonly tabId: string;

  path: string;
  renderer: DiffRendererData;
  diffGroup: 'disk' | 'staged' | 'git' | 'pr';
  originalRef: GitObjectRef;
  modifiedRef: GitObjectRef | undefined;
  prNumber: number | undefined;
  prBaseOid: string | undefined;
  prHeadOid: string | undefined;
  commitOriginalSha: string | null | undefined;
  commitModifiedSha: string | undefined;
  status: GitChangeStatus | undefined;

  constructor(tabId: string, payload: DiffPayload) {
    this.tabId = tabId;
    this.path = payload.path;
    this.renderer = resolveDiffRenderer(payload.path);
    this.diffGroup = payload.diffGroup;
    this.originalRef = payload.originalRef;
    this.modifiedRef = payload.modifiedRef;
    this.prNumber = payload.prNumber;
    this.prBaseOid = payload.prBaseOid;
    this.prHeadOid = payload.prHeadOid;
    this.commitOriginalSha = payload.commitOriginalSha;
    this.commitModifiedSha = payload.commitModifiedSha;
    this.status = payload.status;

    makeObservable(this, {
      path: observable,
      renderer: observable,
      diffGroup: observable,
      originalRef: observable,
      modifiedRef: observable,
      prNumber: observable,
      prBaseOid: observable,
      prHeadOid: observable,
      commitOriginalSha: observable,
      commitModifiedSha: observable,
      status: observable,
      transition: action,
      updateStatus: action,
    });
  }

  dispose(): void {
    // No resources to clean up.
  }

  /**
   * Transitions this diff tab between 'disk' and 'staged' groups in-place.
   * Called by DiffTabLifecycleStore when a file moves between the staged/unstaged lists.
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
    this.prBaseOid = undefined;
    this.prHeadOid = undefined;
    this.commitOriginalSha = undefined;
    this.commitModifiedSha = undefined;
    this.status = status;
    this.renderer = resolveDiffRenderer(this.path);
  }

  /** Update the status field without changing diff group/refs. */
  updateStatus(status: GitChangeStatus | undefined): void {
    this.status = status;
  }

  toActiveFile(): ActiveFile {
    return {
      path: this.path,
      type: this.diffGroup === 'disk' ? 'disk' : 'git',
      group: this.diffGroup,
      originalRef: this.originalRef,
      modifiedRef: this.modifiedRef,
      prNumber: this.prNumber,
      prBaseOid: this.prBaseOid,
      prHeadOid: this.prHeadOid,
      commitOriginalSha: this.commitOriginalSha,
      commitModifiedSha: this.commitModifiedSha,
    };
  }
}

function resolveDiffRenderer(path: string): DiffRendererData {
  const kind = getFileKind(path);
  if (kind === 'image' || kind === 'svg') return { kind: 'image' };
  if (kind === 'binary') return { kind: 'binary' };
  return { kind: 'text' };
}
