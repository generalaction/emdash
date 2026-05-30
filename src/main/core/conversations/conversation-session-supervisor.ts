import type { Pty } from '@main/core/pty/pty';

export type ConversationStartReason = 'create' | 'hydrate' | 'replace-after-exit' | 'manual-retry';

export type ConversationStopReason =
  | 'dehydrate'
  | 'delete'
  | 'task-destroy'
  | 'resource-monitor'
  | 'user-stop';

export type ConversationSpawnToken = {
  sessionId: string;
  generation: number;
  reason: ConversationStartReason;
};

type ConversationRuntime = {
  desired: boolean;
  pty?: Pty;
  spawnInFlightGeneration?: number;
  replacementGeneration: number;
  replacementAttemptedInWindow: boolean;
  stableTimer?: ReturnType<typeof setTimeout>;
  lastStopReason?: ConversationStopReason;
};

export const CONVERSATION_REPLACEMENT_SUSTAINED_MS = 5_000;

export type ExitDecision =
  | { kind: 'stale' }
  | { kind: 'stopped' }
  | { kind: 'replace' }
  | { kind: 'failed' };

export class ConversationSessionSupervisor {
  private runtimes = new Map<string, ConversationRuntime>();

  beginStart(
    sessionId: string,
    _size: { cols: number; rows: number },
    reason: ConversationStartReason,
    options: { requireDesired?: boolean } = {}
  ): ConversationSpawnToken | undefined {
    const runtime = this.getOrCreateRuntime(sessionId);
    if (runtime.pty || runtime.spawnInFlightGeneration !== undefined) return undefined;
    if (options.requireDesired === true && !runtime.desired) return undefined;

    runtime.desired = true;
    runtime.lastStopReason = undefined;
    runtime.replacementGeneration += 1;
    runtime.spawnInFlightGeneration = runtime.replacementGeneration;

    return { sessionId, generation: runtime.replacementGeneration, reason };
  }

  acceptSpawn(sessionId: string, token: ConversationSpawnToken, pty: Pty): boolean {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime || runtime.spawnInFlightGeneration !== token.generation) return false;

    runtime.spawnInFlightGeneration = undefined;
    if (!runtime.desired || runtime.replacementGeneration !== token.generation) return false;

    runtime.pty = pty;
    this.armStableTimer(runtime);
    return true;
  }

  failSpawn(sessionId: string, token: ConversationSpawnToken): boolean {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime || runtime.spawnInFlightGeneration !== token.generation) return false;
    runtime.spawnInFlightGeneration = undefined;
    runtime.replacementAttemptedInWindow = false;
    return runtime.desired;
  }

  stop(sessionId: string, reason: ConversationStopReason): Pty | undefined {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) return undefined;

    runtime.desired = false;
    runtime.lastStopReason = reason;
    runtime.replacementGeneration += 1;
    runtime.spawnInFlightGeneration = undefined;
    this.clearStableTimer(runtime);

    const pty = runtime.pty;
    runtime.pty = undefined;
    runtime.replacementAttemptedInWindow = false;
    return pty;
  }

  getCurrentPty(sessionId: string): Pty | undefined {
    return this.runtimes.get(sessionId)?.pty;
  }

  isDesired(sessionId: string): boolean {
    return this.runtimes.get(sessionId)?.desired === true;
  }

  isCurrentPty(sessionId: string, pty: Pty): boolean {
    return this.runtimes.get(sessionId)?.pty === pty;
  }

  handleExit(sessionId: string, pty: Pty): ExitDecision {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime || runtime.pty !== pty) return { kind: 'stale' };

    runtime.pty = undefined;
    runtime.spawnInFlightGeneration = undefined;
    this.clearStableTimer(runtime);

    if (!runtime.desired) return { kind: 'stopped' };

    if (runtime.replacementAttemptedInWindow || runtime.spawnInFlightGeneration !== undefined) {
      runtime.desired = false;
      runtime.replacementAttemptedInWindow = false;
      return { kind: 'failed' };
    }

    runtime.replacementAttemptedInWindow = true;
    return { kind: 'replace' };
  }

  forget(sessionId: string): void {
    const runtime = this.runtimes.get(sessionId);
    if (runtime) this.clearStableTimer(runtime);
    this.runtimes.delete(sessionId);
  }

  private getOrCreateRuntime(sessionId: string): ConversationRuntime {
    let runtime = this.runtimes.get(sessionId);
    if (!runtime) {
      runtime = {
        desired: false,
        replacementGeneration: 0,
        replacementAttemptedInWindow: false,
      };
      this.runtimes.set(sessionId, runtime);
    }
    return runtime;
  }

  private armStableTimer(runtime: ConversationRuntime): void {
    this.clearStableTimer(runtime);
    runtime.stableTimer = setTimeout(() => {
      runtime.replacementAttemptedInWindow = false;
      runtime.stableTimer = undefined;
    }, CONVERSATION_REPLACEMENT_SUSTAINED_MS);
  }

  private clearStableTimer(runtime: ConversationRuntime): void {
    if (runtime.stableTimer !== undefined) {
      clearTimeout(runtime.stableTimer);
      runtime.stableTimer = undefined;
    }
  }
}
