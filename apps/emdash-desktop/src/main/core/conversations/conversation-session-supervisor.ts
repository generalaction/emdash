import type { Pty } from '@main/core/pty/pty';

type ConversationSpawnToken = {
  mode: ConversationSpawnMode;
  freshRecovery: boolean;
};

type ConversationSpawnMode = 'fresh' | 'resume';

type ActiveConversationPty = {
  pty: Pty;
  mode: ConversationSpawnMode;
  freshRecovery: boolean;
};

type ConversationRuntime = {
  desired: boolean;
  active?: ActiveConversationPty;
  spawnInFlight?: ConversationSpawnToken;
  consecutiveResumeExits: number;
  recoveryGraceTimer?: ReturnType<typeof setTimeout>;
};

export const MAX_CONVERSATION_RESUME_ATTEMPTS = 1;
export const CONVERSATION_FRESH_RECOVERY_GRACE_MS = 5_000;

export type ExitDecision =
  | { kind: 'stale' }
  | { kind: 'stopped' }
  | { kind: 'failed' }
  | { kind: 'respawnFresh' }
  | { kind: 'respawnResume' };

export class ConversationSessionSupervisor {
  private runtimes = new Map<string, ConversationRuntime>();

  beginStart(
    sessionId: string,
    options: { requireDesired?: boolean; mode?: ConversationSpawnMode } = {}
  ): ConversationSpawnToken | undefined {
    const runtime = this.getOrCreateRuntime(sessionId);
    if (runtime.active || runtime.spawnInFlight) return undefined;
    if (options.requireDesired === true && !runtime.desired) return undefined;

    runtime.desired = true;
    const mode = options.mode ?? 'fresh';
    const token = {
      mode,
      freshRecovery:
        mode === 'fresh' && runtime.consecutiveResumeExits >= MAX_CONVERSATION_RESUME_ATTEMPTS,
    };
    runtime.spawnInFlight = token;
    return token;
  }

  acceptSpawn(sessionId: string, token: ConversationSpawnToken, pty: Pty): boolean {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime || runtime.spawnInFlight !== token) return false;

    runtime.spawnInFlight = undefined;
    if (!runtime.desired) return false;

    runtime.active = {
      pty,
      mode: token.mode,
      freshRecovery: token.freshRecovery,
    };
    if (token.freshRecovery) {
      this.scheduleRecoveryReset(sessionId, runtime, pty);
    }
    return true;
  }

  failSpawn(sessionId: string, token: ConversationSpawnToken): void {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime || runtime.spawnInFlight !== token) return;
    runtime.spawnInFlight = undefined;
  }

  stop(sessionId: string): Pty | undefined {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) return undefined;

    runtime.desired = false;
    runtime.spawnInFlight = undefined;
    this.clearRecoveryGraceTimer(runtime);

    const pty = runtime.active?.pty;
    runtime.active = undefined;
    runtime.consecutiveResumeExits = 0;
    return pty;
  }

  isDesired(sessionId: string): boolean {
    return this.runtimes.get(sessionId)?.desired === true;
  }

  handleExit(sessionId: string, pty: Pty): ExitDecision {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime || runtime.active?.pty !== pty) return { kind: 'stale' };

    const exitedMode = runtime.active.mode;
    const freshRecovery = runtime.active.freshRecovery;
    runtime.active = undefined;
    runtime.spawnInFlight = undefined;
    this.clearRecoveryGraceTimer(runtime);

    if (!runtime.desired) return { kind: 'stopped' };

    if (exitedMode === 'resume') {
      runtime.consecutiveResumeExits += 1;
      if (runtime.consecutiveResumeExits >= MAX_CONVERSATION_RESUME_ATTEMPTS) {
        runtime.consecutiveResumeExits = MAX_CONVERSATION_RESUME_ATTEMPTS;
        return { kind: 'respawnFresh' };
      }
      return { kind: 'respawnResume' };
    }

    if (freshRecovery && runtime.consecutiveResumeExits >= MAX_CONVERSATION_RESUME_ATTEMPTS) {
      runtime.desired = false;
      runtime.consecutiveResumeExits = 0;
      return { kind: 'failed' };
    }

    runtime.consecutiveResumeExits = 0;
    return { kind: 'respawnResume' };
  }

  forget(sessionId: string): void {
    const runtime = this.runtimes.get(sessionId);
    if (runtime) this.clearRecoveryGraceTimer(runtime);
    this.runtimes.delete(sessionId);
  }

  private scheduleRecoveryReset(sessionId: string, runtime: ConversationRuntime, pty: Pty): void {
    this.clearRecoveryGraceTimer(runtime);
    runtime.recoveryGraceTimer = setTimeout(() => {
      if (this.runtimes.get(sessionId) !== runtime) return;
      if (runtime.active?.pty !== pty || !runtime.active.freshRecovery) return;

      runtime.active = {
        ...runtime.active,
        freshRecovery: false,
      };
      runtime.consecutiveResumeExits = 0;
      runtime.recoveryGraceTimer = undefined;
    }, CONVERSATION_FRESH_RECOVERY_GRACE_MS);
  }

  private clearRecoveryGraceTimer(runtime: ConversationRuntime): void {
    if (!runtime.recoveryGraceTimer) return;
    clearTimeout(runtime.recoveryGraceTimer);
    runtime.recoveryGraceTimer = undefined;
  }

  private getOrCreateRuntime(sessionId: string): ConversationRuntime {
    let runtime = this.runtimes.get(sessionId);
    if (!runtime) {
      runtime = {
        desired: false,
        consecutiveResumeExits: 0,
      };
      this.runtimes.set(sessionId, runtime);
    }
    return runtime;
  }
}
