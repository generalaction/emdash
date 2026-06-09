import type { WorkspaceGitProvider } from '@main/core/git/workspace-git-provider';
import { refreshWorkspaceCurrentBranchCache } from '@main/core/workspaces/workspace-current-branch-cache';
import { events } from '@main/lib/events';
import type { GitStatusUntrackedMode } from '@shared/core/git/git';
import { gitWorkspaceChangedChannel } from '@shared/core/git/gitEvents';

const TRACKED_POLL_MS = 10_000;
const UNTRACKED_POLL_MS = 30_000;

export class RemoteStatusFingerprintPoller {
  private active = false;
  private generation = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private inFlight = false;
  private fingerprints: Partial<Record<GitStatusUntrackedMode, string>> = {};
  private branchBaselineLoaded = false;

  constructor(
    private readonly projectId: string,
    private readonly workspaceId: string,
    private readonly git: WorkspaceGitProvider
  ) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    this.generation += 1;

    const generation = this.generation;
    void this.initialize(generation);
    this.timers.push(
      setInterval(() => void this.pollOne(generation, 'no'), TRACKED_POLL_MS),
      setInterval(() => void this.pollOne(generation, 'normal'), UNTRACKED_POLL_MS)
    );
  }

  stop(): void {
    this.active = false;
    this.generation += 1;
    this.inFlight = false;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  private async initialize(generation: number): Promise<void> {
    await this.pollBoth(generation, { invalidateWithoutBaseline: true });
  }

  private async pollBoth(
    generation: number,
    options?: { invalidateWithoutBaseline?: boolean }
  ): Promise<void> {
    if (!this.isCurrent(generation) || this.inFlight) return;
    this.inFlight = true;

    try {
      const [trackedChanged, untrackedChanged, branchChanged] = await Promise.all([
        this.updateFingerprint(generation, 'no', options),
        this.updateFingerprint(generation, 'normal', options),
        this.updateBranch(generation),
      ]);
      if (!this.isCurrent(generation)) return;
      if (trackedChanged || untrackedChanged) this.emitIndexChanged();
      if (branchChanged) this.emitHeadChanged();
    } finally {
      if (this.generation === generation) this.inFlight = false;
    }
  }

  private async pollOne(generation: number, untracked: GitStatusUntrackedMode): Promise<void> {
    if (!this.isCurrent(generation) || this.inFlight) return;
    this.inFlight = true;

    try {
      const [fingerprintChanged, branchChanged] = await Promise.all([
        this.updateFingerprint(generation, untracked),
        untracked === 'no' ? this.updateBranch(generation) : Promise.resolve(false),
      ]);
      if (!this.isCurrent(generation)) return;
      if (fingerprintChanged) this.emitIndexChanged();
      if (branchChanged) this.emitHeadChanged();
    } finally {
      if (this.generation === generation) this.inFlight = false;
    }
  }

  private async updateFingerprint(
    generation: number,
    untracked: GitStatusUntrackedMode,
    options?: { invalidateWithoutBaseline?: boolean }
  ): Promise<boolean> {
    const fingerprint = await this.git.getStatusFingerprint(untracked).catch(() => null);
    if (!fingerprint || !this.isCurrent(generation)) return false;

    const previous = this.fingerprints[untracked];
    this.fingerprints[untracked] = fingerprint.hash;
    return previous === undefined
      ? (options?.invalidateWithoutBaseline ?? false)
      : previous !== fingerprint.hash;
  }

  private async updateBranch(generation: number): Promise<boolean> {
    const result = await refreshWorkspaceCurrentBranchCache(this.workspaceId, this.git);
    if (!result || !this.isCurrent(generation)) return false;

    if (!this.branchBaselineLoaded) {
      this.branchBaselineLoaded = true;
      return false;
    }

    return result.changed;
  }

  private isCurrent(generation: number): boolean {
    return this.active && this.generation === generation;
  }

  private emitIndexChanged(): void {
    events.emit(gitWorkspaceChangedChannel, {
      projectId: this.projectId,
      workspaceId: this.workspaceId,
      kind: 'index',
    });
  }

  private emitHeadChanged(): void {
    events.emit(gitWorkspaceChangedChannel, {
      projectId: this.projectId,
      workspaceId: this.workspaceId,
      kind: 'head',
    });
  }
}
