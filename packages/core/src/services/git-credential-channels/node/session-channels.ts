import type { Logger } from '@emdash/shared/logger';
import type { GitCredentialsSessionSpec } from '#primitives/git-credentials/api';

/** Hands one credential channel back to the desktop that minted it. */
export type ReleaseGitCredentialChannel = (nonce: string) => Promise<void>;

/**
 * The session runtime's half of a Git credential channel's lifetime (spec:
 * github-git-settings §4). The desktop mints a channel for a start request and hands
 * the same one again while the session runs with it. From then on the runtime owns it:
 * a session holds the channel it spawned with until its process ends or the session is
 * evicted, and a channel that no session holds is released at once. A released channel
 * answers no further credential requests.
 *
 * A tmux-backed session's process is a tmux client: its exit (e.g. a detach) can leave the
 * shell or agent inside running with the channel the tmux session was created with, so
 * such a session keeps its channel until the runtime ends the session.
 */
export class SessionGitCredentialChannels {
  private readonly held = new Map<string, string>();

  constructor(
    private readonly releaseChannel: ReleaseGitCredentialChannel,
    private readonly logger?: Pick<Logger, 'warn'>
  ) {}

  /** Session `key` spawns with `spec`; the channel it held before is released unless reused. */
  async hold(key: string, spec: GitCredentialsSessionSpec | undefined): Promise<void> {
    const nonce = channelNonce(spec);
    const previous = this.held.get(key);
    if (nonce) this.held.set(key, nonce);
    else this.held.delete(key);
    if (previous && previous !== nonce) await this.releaseNonce(previous);
  }

  /** A start request for `key` spawned nothing; its channel is released unless `key` holds it. */
  async releaseUnheld(key: string, spec: GitCredentialsSessionSpec | undefined): Promise<void> {
    const nonce = channelNonce(spec);
    if (nonce && nonce !== this.held.get(key)) await this.releaseNonce(nonce);
  }

  /** Session `key` ended; the channel it held is released. */
  async release(key: string): Promise<void> {
    const nonce = this.held.get(key);
    if (!nonce) return;
    this.held.delete(key);
    await this.releaseNonce(nonce);
  }

  /** Runs `evict` with `key`'s channel kept out of it, so a restart keeps the channel. */
  async keepThrough(key: string, evict: () => Promise<void>): Promise<void> {
    const nonce = this.held.get(key);
    this.held.delete(key);
    try {
      await evict();
    } finally {
      if (nonce) this.held.set(key, nonce);
    }
  }

  /**
   * The process `key` spawned with `spec` exited; its channel is released if `key` still
   * holds it. A late exit of a replaced process must not release its successor's channel.
   */
  async releaseExited(key: string, spec: GitCredentialsSessionSpec | undefined): Promise<void> {
    const nonce = channelNonce(spec);
    if (nonce && nonce === this.held.get(key)) await this.release(key);
  }

  private async releaseNonce(nonce: string): Promise<void> {
    try {
      await this.releaseChannel(nonce);
    } catch (error) {
      // Session control must not fail on this; the channel stays valid until the
      // desktop that minted it exits.
      this.logger?.warn('Failed to release a Git credential channel', { error: String(error) });
    }
  }
}

function channelNonce(spec: GitCredentialsSessionSpec | undefined): string | undefined {
  return spec?.mode === 'effective-account' ? spec.channel.nonce : undefined;
}
