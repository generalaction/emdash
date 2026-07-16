import type { PromptDraftState } from '@emdash/core/acp/client';

export interface DraftStateObservation {
  applyText: boolean;
  text: string;
}

/** Tracks the runtime revision separately from local edit ordering. */
export class AcpDraftSyncState {
  private revision: number | null = null;
  private localEditVersion = 0;
  private synchronizedEditVersion = 0;

  get expectedRevision(): number | null {
    return this.revision;
  }

  get currentEditVersion(): number {
    return this.localEditVersion;
  }

  get hasPendingWrite(): boolean {
    return this.localEditVersion > this.synchronizedEditVersion;
  }

  markLocalEdit(): number {
    this.localEditVersion += 1;
    return this.localEditVersion;
  }

  observe(
    state: PromptDraftState,
    options: { resetRevision?: boolean } = {}
  ): DraftStateObservation {
    if (!options.resetRevision && isOlderRevision(state.rev, this.revision)) {
      return { applyText: false, text: '' };
    }

    this.revision = state.rev;
    if (this.hasPendingWrite) return { applyText: false, text: '' };
    return { applyText: true, text: state.draft?.text ?? '' };
  }

  markWriteApplied(editVersion: number, state: PromptDraftState): void {
    this.advanceRevision(state.rev);
    this.synchronizedEditVersion = Math.max(this.synchronizedEditVersion, editVersion);
  }

  markWriteConflict(state: PromptDraftState): void {
    this.advanceRevision(state.rev);
  }

  private advanceRevision(revision: number | null): void {
    if (!isOlderRevision(revision, this.revision)) this.revision = revision;
  }
}

function isOlderRevision(candidate: number | null, current: number | null): boolean {
  if (current === null) return false;
  if (candidate === null) return true;
  return candidate < current;
}
