import { gitWorkspaceChangedChannel } from '@shared/events/gitEvents';
import type { GitStatusUntrackedMode } from '@shared/git';
import type { WorkspaceGitProvider } from '@main/core/git/workspace-git-provider';
import { events } from '@main/lib/events';

const TRACKED_POLL_MS = 10_000;
const UNTRACKED_POLL_MS = 30_000;

export class RemoteStatusFingerprintPoller {
  private active = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  private inFlight = false;
  private fingerprints: Partial<Record<GitStatusUntrackedMode, string>> = {};

  constructor(
    private readonly projectId: string,
    private readonly workspaceId: string,
    private readonly git: WorkspaceGitProvider
  ) {}

  start(): void {
    if (this.active) return;
    this.active = true;

    void this.initialize();
    this.timers.push(
      setInterval(() => void this.pollOne('no'), TRACKED_POLL_MS),
      setInterval(() => void this.pollOne('normal'), UNTRACKED_POLL_MS)
    );
  }

  stop(): void {
    this.active = false;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  private async initialize(): Promise<void> {
    await this.pollBoth({ invalidateWithoutBaseline: true });
  }

  private async pollBoth(options?: { invalidateWithoutBaseline?: boolean }): Promise<void> {
    if (!this.active || this.inFlight) return;
    this.inFlight = true;

    try {
      const trackedChanged = await this.updateFingerprint('no', options);
      const untrackedChanged = await this.updateFingerprint('normal', options);
      if (this.active && (trackedChanged || untrackedChanged)) this.emitChanged();
    } finally {
      this.inFlight = false;
    }
  }

  private async pollOne(untracked: GitStatusUntrackedMode): Promise<void> {
    if (!this.active || this.inFlight) return;
    this.inFlight = true;

    try {
      if (this.active && (await this.updateFingerprint(untracked))) this.emitChanged();
    } finally {
      this.inFlight = false;
    }
  }

  private async updateFingerprint(
    untracked: GitStatusUntrackedMode,
    options?: { invalidateWithoutBaseline?: boolean }
  ): Promise<boolean> {
    const fingerprint = await this.git.getStatusFingerprint(untracked).catch(() => null);
    if (!fingerprint) return false;

    const previous = this.fingerprints[untracked];
    this.fingerprints[untracked] = fingerprint.hash;
    return previous === undefined
      ? (options?.invalidateWithoutBaseline ?? false)
      : previous !== fingerprint.hash;
  }

  private emitChanged(): void {
    events.emit(gitWorkspaceChangedChannel, {
      projectId: this.projectId,
      workspaceId: this.workspaceId,
      kind: 'index',
    });
  }
}
