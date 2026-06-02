import type { Pty } from '@main/core/pty/pty';

export type ConversationSpawnToken = {
  mode: ConversationSpawnMode;
};

export type ConversationSpawnMode = 'fresh' | 'resume';

type ActiveConversationPty = {
  pty: Pty;
  mode: ConversationSpawnMode;
};

type ConversationRuntime = {
  desired: boolean;
  active?: ActiveConversationPty;
  spawnInFlight?: ConversationSpawnToken;
  consecutiveResumeExits: number;
};

export const MAX_CONVERSATION_RESUME_REPLACEMENTS = 3;

export type ExitDecision =
  | { kind: 'stale' }
  | { kind: 'stopped' }
  | { kind: 'replace'; mode: ConversationSpawnMode };

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
    const token = { mode: options.mode ?? 'fresh' };
    runtime.spawnInFlight = token;
    return token;
  }

  acceptSpawn(sessionId: string, token: ConversationSpawnToken, pty: Pty): boolean {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime || runtime.spawnInFlight !== token) return false;

    runtime.spawnInFlight = undefined;
    if (!runtime.desired) return false;

    runtime.active = { pty, mode: token.mode };
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
    runtime.active = undefined;
    runtime.spawnInFlight = undefined;

    if (!runtime.desired) return { kind: 'stopped' };

    if (exitedMode === 'resume') {
      runtime.consecutiveResumeExits += 1;
      if (runtime.consecutiveResumeExits >= MAX_CONVERSATION_RESUME_REPLACEMENTS) {
        runtime.consecutiveResumeExits = 0;
        return { kind: 'replace', mode: 'fresh' };
      }
      return { kind: 'replace', mode: 'resume' };
    }

    runtime.consecutiveResumeExits = 0;
    return { kind: 'replace', mode: 'resume' };
  }

  forget(sessionId: string): void {
    this.runtimes.delete(sessionId);
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
