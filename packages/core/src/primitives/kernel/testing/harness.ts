import type { AnyOperationDefinition, ResultOf } from '../api/definition';
import { createOperationHandler, type OperationHandler } from '../api/handler';
import type { OperationProgress, ProgressSink } from '../api/progress';
import { defineResource } from '../api/resources';
import type { Clock } from '../engine/execution';

export class FakeClock implements Clock {
  private current: number;
  private readonly timers: Array<{ dueAt: number; callback: () => void }> = [];

  constructor(start = 0) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    this.timers.push({ dueAt: this.current + ms, callback });
    this.timers.sort((a, b) => a.dueAt - b.dueAt);
    return callback;
  }

  advance(ms: number): void {
    const target = this.current + ms;
    let next = this.timers[0];
    while (next && next.dueAt <= target) {
      const timer = this.timers.shift();
      if (!timer) {
        break;
      }
      this.current = timer.dueAt;
      timer.callback();
      next = this.timers[0];
    }
    this.current = target;
  }
}

export class CaptureProgressSink implements ProgressSink {
  readonly published: OperationProgress[] = [];
  readonly ended: string[] = [];

  publish(progress: OperationProgress): void {
    this.published.push({
      ...progress,
      stages: progress.stages.map((stage) => ({ ...stage })),
    });
  }

  end(operationId: string): void {
    this.ended.push(operationId);
  }
}

export const hostResource = defineResource({
  name: 'host',
  key: (ref: { hostId: string }) => `host:${ref.hostId}`,
});

export const repoResource = defineResource({
  name: 'repo',
  key: (ref: { hostId: string; repoPath: string }) => `repo:${ref.hostId}:${ref.repoPath}`,
  parent: (ref) => ({ def: hostResource, ref: { hostId: ref.hostId } }),
});

export const worktreeResource = defineResource({
  name: 'worktree',
  key: (ref: { hostId: string; repoPath: string; worktreePath: string }) =>
    `worktree:${ref.hostId}:${ref.worktreePath}`,
  parent: (ref) => ({
    def: repoResource,
    ref: { hostId: ref.hostId, repoPath: ref.repoPath },
  }),
});

export interface ScriptedHandlerStep<TResult> {
  id: string;
  label: string;
  progress?: number;
  fail?: unknown;
  result?: TResult;
}

export function scriptedHandler<D extends AnyOperationDefinition>(
  definition: D,
  steps: readonly ScriptedHandlerStep<ResultOf<D>>[]
): OperationHandler<D> {
  return createOperationHandler(definition, async (ctx) => {
    let result: ResultOf<D> | undefined;
    for (const step of steps) {
      result = await ctx.stage(step.id, step.label, async (stage) => {
        if (step.progress !== undefined) {
          stage.progress(step.progress);
        }
        if (step.fail !== undefined) {
          throw step.fail;
        }
        return step.result ?? ({} as ResultOf<D>);
      });
    }
    return result ?? ({} as ResultOf<D>);
  });
}
