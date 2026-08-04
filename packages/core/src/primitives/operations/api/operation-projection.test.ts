import type {
  DispatchPassReport,
  OperationProgress,
  OperationRecord,
  OperationStatus,
} from '@primitives/kernel/api';
import { describe, expect, it } from 'vitest';
import {
  projectOperationDisplay,
  projectOperationStages,
  type ParsedOperationProjection,
} from './operation-projection';

describe('operation projection', () => {
  it.each([
    ['pending', emptyReport(), 'queued'],
    [
      'pending',
      {
        started: [],
        skipped: [{ id: 'op-1', blockedBy: ['op-0'], barredOn: [] }],
        deferred: [],
      },
      'waiting',
    ],
    [
      'pending',
      {
        started: [],
        skipped: [],
        deferred: [{ id: 'op-1', reason: 'gated' as const }],
      },
      'blocked-host-offline',
    ],
    ['running', emptyReport(), 'running'],
    ['waiting-children', emptyReport(), 'waiting-children'],
    ['failed', emptyReport(), 'failed'],
    ['succeeded', emptyReport(), 'succeeded'],
  ] satisfies readonly [OperationStatus, DispatchPassReport, string][])(
    'projects a %s record as %s',
    (recordStatus, dispatchReport, expectedStatus) => {
      const projected = projectOperationDisplay(record({ status: recordStatus }), {
        parsedInputs: parsedInputs(),
        progress: new Map(),
        dispatchReport,
        fallbackHostRef: 'local:local',
      });

      expect(projected.status).toBe(expectedStatus);
    }
  );

  it('projects typed confirmation rejection and running progress', () => {
    const awaiting = projectOperationDisplay(
      record({
        status: 'rejected',
        rejectedError: { type: 'needs-confirmation', reason: 'workspace-busy' },
      }),
      {
        parsedInputs: parsedInputs(),
        progress: new Map(),
        dispatchReport: emptyReport(),
        fallbackHostRef: 'local:local',
      }
    );
    expect(awaiting).toMatchObject({
      status: 'awaiting-confirmation',
      confirmationReason: 'workspace-busy',
    });

    const progress: OperationProgress = {
      operationId: 'op-1',
      updatedAt: 2,
      stages: [{ id: 'scan', label: 'Scan', status: 'running', progress: 0.5 }],
    };
    const running = projectOperationDisplay(record({ status: 'running' }), {
      parsedInputs: parsedInputs(),
      progress: new Map([['op-1', progress]]),
      dispatchReport: emptyReport(),
      fallbackHostRef: 'local:local',
    });
    expect(running).toMatchObject({
      status: 'running',
      currentStep: 'scan',
      totalSteps: 1,
      stages: [{ id: 'scan', status: 'running', progress: 0.5 }],
    });
  });

  it('projects ordered stage details from the durable outcome after progress ends', () => {
    const stages = projectOperationStages(
      record({
        status: 'succeeded',
        outcome: {
          version: '2',
          stages: [
            { id: 'inspect', label: 'Inspect worktrees', status: 'succeeded', progress: 1 },
            {
              id: 'teardown',
              label: 'Run teardown script',
              status: 'failed',
              nonFatal: true,
              error: { message: 'teardown failed' },
            },
            { id: 'remove', label: 'Remove worktree', status: 'succeeded', progress: 1 },
          ],
        },
      })
    );

    expect(stages).toEqual([
      { id: 'inspect', label: 'Inspect worktrees', status: 'succeeded', progress: 1 },
      {
        id: 'teardown',
        label: 'Run teardown script',
        status: 'failed',
        nonFatal: true,
        error: { message: 'teardown failed' },
      },
      { id: 'remove', label: 'Remove worktree', status: 'succeeded', progress: 1 },
    ]);
  });
});

function parsedInputs(): Map<string, ParsedOperationProjection> {
  return new Map([
    [
      'op-1',
      {
        displayName: 'Removing worktree',
        entityKind: 'workspace',
        hostRef: 'local:local',
      },
    ],
  ]);
}

function record(overrides: Partial<OperationRecord> = {}): OperationRecord {
  return {
    id: 'op-1',
    seq: 1,
    name: 'host-remove-worktree',
    key: 'workspace:1',
    input: {},
    claims: [],
    status: 'pending',
    attempt: 0,
    initiator: { kind: 'user', action: 'test' },
    createdAt: 1,
    updatedAt: 1,
    error: { message: 'boom' },
    ...overrides,
  };
}

function emptyReport(): DispatchPassReport {
  return { started: [], skipped: [], deferred: [] };
}
