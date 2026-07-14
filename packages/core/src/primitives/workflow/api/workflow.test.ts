import { createScope } from '@emdash/shared/concurrency';
import { retrySchedules } from '@emdash/shared/scheduling';
import { ManualClock, deferred } from '@emdash/shared/testing';
import { describe, expect, it } from 'vitest';
import { defineWorkflowNode, type Workflow, type WorkflowNodeDefinition } from './types';
import { createWorkflow } from './workflow';

describe('createWorkflow', () => {
  it('runs a linear workflow and returns facts and warnings', async () => {
    const workflow = createWorkflowOrThrow([
      defineWorkflowNode({
        id: 'setup',
        run: () => ({
          status: 'done',
          facts: { path: '/workspace' },
          warnings: [{ type: 'notice', message: 'ok' }],
        }),
      }),
      defineWorkflowNode({
        id: 'build',
        dependsOn: ['setup'],
        run: ({ deps }) => ({
          status: 'done',
          facts: { input: deps.setup },
        }),
      }),
    ]);

    try {
      const result = await workflow.run();

      expect(result).toEqual({
        success: true,
        data: {
          facts: {
            setup: { path: '/workspace' },
            build: { input: { path: '/workspace' } },
          },
          warnings: [{ type: 'notice', message: 'ok' }],
        },
      });
    } finally {
      workflow.dispose();
    }
  });

  it('starts independent roots in parallel and unblocks dependents after both finish', async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const started: string[] = [];
    const workflow = createWorkflowOrThrow([
      defineWorkflowNode({
        id: 'first',
        async run() {
          started.push('first');
          await first.promise;
          return { status: 'done' };
        },
      }),
      defineWorkflowNode({
        id: 'second',
        async run() {
          started.push('second');
          await second.promise;
          return { status: 'done' };
        },
      }),
      defineWorkflowNode({
        id: 'join',
        dependsOn: ['first', 'second'],
        run() {
          started.push('join');
          return { status: 'done' };
        },
      }),
    ]);

    try {
      const resultPromise = workflow.run();
      await flushMicrotasks();
      expect(started).toEqual(['first', 'second']);
      expect(workflow.machine.current().nodes.join.status).toBe('pending');

      first.resolve();
      await flushMicrotasks();
      expect(workflow.machine.current().nodes.join.status).toBe('pending');

      second.resolve();
      const result = await resultPromise;
      expect(result.success).toBe(true);
      expect(started).toEqual(['first', 'second', 'join']);
    } finally {
      workflow.dispose();
    }
  });

  it('retries transient failures using the provided clock', async () => {
    const clock = new ManualClock();
    let attempts = 0;
    const workflow = createWorkflowOrThrow(
      [
        defineWorkflowNode({
          id: 'fetch',
          retry: retrySchedules.sequence([100, 100]),
          run() {
            attempts++;
            return attempts < 3
              ? {
                  status: 'failed',
                  failure: 'transient',
                  error: { type: 'network', message: 'try again' },
                }
              : { status: 'done', facts: { attempts } };
          },
        }),
      ],
      { clock }
    );

    try {
      const resultPromise = workflow.run();
      await flushMicrotasks();
      expect(attempts).toBe(1);

      await clock.runAll();
      const result = await resultPromise;
      expect(result.success).toBe(true);
      expect(attempts).toBe(3);
      expect(workflow.machine.current().nodes.fetch.attempt).toBe(3);
    } finally {
      workflow.dispose();
    }
  });

  it('turns non-fatal failures into warnings and continues', async () => {
    const workflow = createWorkflowOrThrow([
      defineWorkflowNode({
        id: 'optional',
        fatal: false,
        run: () => ({
          status: 'failed',
          failure: 'permanent',
          error: { type: 'optional-failed', message: 'ignored' },
        }),
      }),
      defineWorkflowNode({
        id: 'after',
        dependsOn: ['optional'],
        run: () => ({ status: 'done' }),
      }),
    ]);

    try {
      const result = await workflow.run();

      expect(result).toEqual({
        success: true,
        data: {
          facts: {
            optional: {},
            after: {},
          },
          warnings: [{ type: 'optional-failed', message: 'ignored' }],
        },
      });
    } finally {
      workflow.dispose();
    }
  });

  it('marks pending nodes as skipped on fatal failure', async () => {
    const workflow = createWorkflowOrThrow([
      defineWorkflowNode({
        id: 'setup',
        run: () => ({
          status: 'failed',
          failure: 'permanent',
          error: { type: 'setup-failed', message: 'boom' },
        }),
      }),
      defineWorkflowNode({
        id: 'build',
        dependsOn: ['setup'],
        run: () => ({ status: 'done' }),
      }),
    ]);

    try {
      const result = await workflow.run();

      expect(result).toEqual({
        success: false,
        error: { type: 'setup-failed', message: 'boom' },
      });
      expect(workflow.machine.current().nodes.setup.status).toBe('failed');
      expect(workflow.machine.current().nodes.build.status).toBe('skipped');
    } finally {
      workflow.dispose();
    }
  });

  it('cancels before starting and skips pending nodes', async () => {
    const abort = new AbortController();
    abort.abort();
    const workflow = createWorkflowOrThrow(
      [
        defineWorkflowNode({
          id: 'setup',
          run: () => ({ status: 'done' }),
        }),
      ],
      { signal: abort.signal }
    );

    try {
      const result = await workflow.run();

      expect(result).toEqual({
        success: false,
        error: { type: 'cancelled', message: 'Workflow was cancelled' },
      });
      expect(workflow.machine.current().nodes.setup.status).toBe('skipped');
    } finally {
      workflow.dispose();
    }
  });

  it('publishes progress and output events', async () => {
    const output: Array<{ nodeId: string; chunk: string }> = [];
    const workflow = createWorkflowOrThrow(
      [
        defineWorkflowNode({
          id: 'script',
          run(ctx) {
            ctx.emit('hello');
            ctx.report({ percent: 50, message: 'working' });
            return { status: 'done' };
          },
        }),
      ],
      { onOutput: (event) => output.push(event) }
    );

    try {
      const result = await workflow.run();

      expect(result.success).toBe(true);
      expect(output).toEqual([{ nodeId: 'script', chunk: 'hello' }]);
      expect(workflow.machine.current().nodes.script.progress).toBeUndefined();
    } finally {
      workflow.dispose();
    }
  });
});

function createWorkflowOrThrow(
  nodes: WorkflowNodeDefinition[],
  options: {
    clock?: ManualClock;
    signal?: AbortSignal;
    onOutput?: (event: { nodeId: string; chunk: string }) => void;
  } = {}
): Workflow {
  const scope = createScope({ label: 'test-workflow', clock: options.clock });
  const workflow = createWorkflow({
    nodes,
    scope,
    clock: options.clock,
    signal: options.signal,
    onOutput: options.onOutput,
  });
  if (!workflow.success) throw new Error(workflow.error.message);
  scope.add(() => workflow.data.dispose());
  return workflow.data;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
