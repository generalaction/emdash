import type { PtyHandle } from '../transport';

export type ConversationSpawnMode = 'fresh' | 'resume';

export type ConversationSpawnToken = {
  mode: ConversationSpawnMode;
  freshRecovery: boolean;
};

type ActiveConversationPty = {
  pty: PtyHandle;
  mode: ConversationSpawnMode;
  freshRecovery: boolean;
};

export const MAX_CONVERSATION_RESUME_ATTEMPTS = 1;
export const CONVERSATION_FRESH_RECOVERY_GRACE_MS = 5_000;

export type ExitDecision =
  | { kind: 'stale' }
  | { kind: 'stopped' }
  | { kind: 'failed' }
  | { kind: 'respawnFresh' }
  | { kind: 'respawnResume' };

export class SessionRespawnPolicy {
  private desired = false;
  private active?: ActiveConversationPty;
  private spawnInFlight?: ConversationSpawnToken;
  private consecutiveResumeExits = 0;
  private recoveryGraceTimer?: ReturnType<typeof setTimeout>;

  beginStart(
    options: { requireDesired?: boolean; mode?: ConversationSpawnMode } = {}
  ): ConversationSpawnToken | undefined {
    if (this.active || this.spawnInFlight) return undefined;
    if (options.requireDesired === true && !this.desired) return undefined;

    this.desired = true;
    const mode = options.mode ?? 'fresh';
    const token = {
      mode,
      freshRecovery: mode === 'fresh' && this.consecutiveResumeExits >= MAX_CONVERSATION_RESUME_ATTEMPTS,
    };
    this.spawnInFlight = token;
    return token;
  }

  acceptSpawn(token: ConversationSpawnToken, pty: PtyHandle): boolean {
    if (this.spawnInFlight !== token) return false;

    this.spawnInFlight = undefined;
    if (!this.desired) return false;

    this.active = {
      pty,
      mode: token.mode,
      freshRecovery: token.freshRecovery,
    };
    if (token.freshRecovery) {
      this.scheduleRecoveryReset(pty);
    }
    return true;
  }

  failSpawn(token: ConversationSpawnToken): void {
    if (this.spawnInFlight !== token) return;
    this.spawnInFlight = undefined;
  }

  stop(): PtyHandle | undefined {
    this.desired = false;
    this.spawnInFlight = undefined;
    this.clearRecoveryGraceTimer();

    const pty = this.active?.pty;
    this.active = undefined;
    this.consecutiveResumeExits = 0;
    return pty;
  }

  isDesired(): boolean {
    return this.desired;
  }

  handleExit(pty: PtyHandle): ExitDecision {
    if (this.active?.pty !== pty) return { kind: 'stale' };

    const exitedMode = this.active.mode;
    const freshRecovery = this.active.freshRecovery;
    this.active = undefined;
    this.spawnInFlight = undefined;
    this.clearRecoveryGraceTimer();

    if (!this.desired) return { kind: 'stopped' };

    if (exitedMode === 'resume') {
      this.consecutiveResumeExits += 1;
      if (this.consecutiveResumeExits >= MAX_CONVERSATION_RESUME_ATTEMPTS) {
        this.consecutiveResumeExits = MAX_CONVERSATION_RESUME_ATTEMPTS;
        return { kind: 'respawnFresh' };
      }
      return { kind: 'respawnResume' };
    }

    if (freshRecovery && this.consecutiveResumeExits >= MAX_CONVERSATION_RESUME_ATTEMPTS) {
      this.desired = false;
      this.consecutiveResumeExits = 0;
      return { kind: 'failed' };
    }

    this.consecutiveResumeExits = 0;
    return { kind: 'respawnResume' };
  }

  dispose(): void {
    this.clearRecoveryGraceTimer();
    this.desired = false;
    this.active = undefined;
    this.spawnInFlight = undefined;
    this.consecutiveResumeExits = 0;
  }

  private scheduleRecoveryReset(pty: PtyHandle): void {
    this.clearRecoveryGraceTimer();
    this.recoveryGraceTimer = setTimeout(() => {
      if (this.active?.pty !== pty || !this.active.freshRecovery) return;

      this.active = {
        ...this.active,
        freshRecovery: false,
      };
      this.consecutiveResumeExits = 0;
      this.recoveryGraceTimer = undefined;
    }, CONVERSATION_FRESH_RECOVERY_GRACE_MS);
  }

  private clearRecoveryGraceTimer(): void {
    if (!this.recoveryGraceTimer) return;
    clearTimeout(this.recoveryGraceTimer);
    this.recoveryGraceTimer = undefined;
  }
}
