import type { Scope } from '@emdash/shared/concurrency';
import { systemClock, type Clock, type TimerHandle } from '@emdash/shared/scheduling';
import { z } from 'zod';

export type IoActivitySnapshot = {
  running: boolean;
  busy: boolean;
  attachedClients: number;
  detachedAt: number | null;
  lastInputAt: number | null;
  lastOutputAt: number | null;
};

export type ReapDecision = { action: 'keep' } | { action: 'deactivate'; reason: string };

export type IdlePolicy = (snapshot: IoActivitySnapshot, now: number) => ReapDecision;

export const idlePolicyConfigSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('while-attached'),
    graceMs: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('idle-after'),
    outputMs: z.number().int().positive(),
    inputMs: z.number().int().positive().optional(),
  }),
  z.object({ kind: z.literal('until-complete') }),
  z.object({ kind: z.literal('always') }),
]);

export type IdlePolicyConfig = z.infer<typeof idlePolicyConfigSchema>;

export type IoActivityTracker = {
  recordInput(): void;
  recordOutput(): void;
  attach(): void;
  detach(): void;
  snapshot(): Pick<
    IoActivitySnapshot,
    'attachedClients' | 'detachedAt' | 'lastInputAt' | 'lastOutputAt'
  >;
};

export type IdleSweeper = {
  sweepNow(): Promise<void>;
  dispose(): void;
};

export type IdleSweeperOptions<T> = {
  clock?: Clock;
  scope?: Scope;
  intervalMs: number;
  beforeSweep?: () => Promise<void> | void;
  entries(): Iterable<T>;
  snapshot(entry: T): IoActivitySnapshot | null;
  policy(entry: T): IdlePolicy;
  deactivate(entry: T, reason: string): Promise<void> | void;
  onError?(error: unknown, entry?: T): void;
};

export function compileIdlePolicy(config: IdlePolicyConfig): IdlePolicy {
  switch (config.kind) {
    case 'always':
    case 'until-complete':
      return () => ({ action: 'keep' });
    case 'while-attached':
      return (snapshot, now) => {
        if (snapshot.busy || snapshot.attachedClients > 0 || snapshot.detachedAt === null) {
          return { action: 'keep' };
        }
        return now - snapshot.detachedAt > config.graceMs
          ? { action: 'deactivate', reason: 'detached' }
          : { action: 'keep' };
      };
    case 'idle-after':
      return (snapshot, now) => {
        if (snapshot.busy) return { action: 'keep' };
        const inputMs = config.inputMs ?? config.outputMs;
        const inputIdle = snapshot.lastInputAt === null || now - snapshot.lastInputAt > inputMs;
        const outputIdle =
          snapshot.lastOutputAt === null || now - snapshot.lastOutputAt > config.outputMs;
        return inputIdle && outputIdle
          ? { action: 'deactivate', reason: 'idle' }
          : { action: 'keep' };
      };
  }
}

export function createIoActivityTracker(
  now: () => number,
  options: { outputThrottleMs?: number } = {}
): IoActivityTracker {
  const outputThrottleMs = options.outputThrottleMs ?? 30_000;
  let lastInputAt: number | null = null;
  let lastOutputAt: number | null = null;
  let attachedClients = 0;
  let detachedAt: number | null = now();

  return {
    recordInput() {
      lastInputAt = now();
    },
    recordOutput() {
      const timestamp = now();
      if (lastOutputAt === null || timestamp - lastOutputAt >= outputThrottleMs) {
        lastOutputAt = timestamp;
      }
    },
    attach() {
      attachedClients += 1;
      detachedAt = null;
    },
    detach() {
      attachedClients = Math.max(0, attachedClients - 1);
      if (attachedClients === 0) detachedAt = now();
    },
    snapshot() {
      return { attachedClients, detachedAt, lastInputAt, lastOutputAt };
    },
  };
}

export function createIdleSweeper<T>(options: IdleSweeperOptions<T>): IdleSweeper {
  const clock = options.clock ?? systemClock;
  let timer: TimerHandle | undefined;
  let disposed = false;
  let sweeping: Promise<void> | null = null;

  const scheduleNext = () => {
    if (disposed) return;
    timer = clock.schedule(
      options.intervalMs,
      () => {
        void runSweep().finally(scheduleNext);
      },
      { unref: true }
    );
  };

  const runSweep = async () => {
    if (sweeping) return sweeping;
    sweeping = (async () => {
      try {
        try {
          await options.beforeSweep?.();
        } catch (error) {
          options.onError?.(error);
        }

        for (const entry of options.entries()) {
          try {
            const snapshot = options.snapshot(entry);
            if (!snapshot) continue;
            const decision = options.policy(entry)(snapshot, clock.now());
            if (decision.action === 'deactivate') {
              await options.deactivate(entry, decision.reason);
            }
          } catch (error) {
            options.onError?.(error, entry);
          }
        }
      } finally {
        sweeping = null;
      }
    })();
    return sweeping;
  };

  scheduleNext();
  options.scope?.add(() => {
    disposed = true;
    timer?.dispose();
  });

  return {
    sweepNow: runSweep,
    dispose() {
      disposed = true;
      timer?.dispose();
    },
  };
}
