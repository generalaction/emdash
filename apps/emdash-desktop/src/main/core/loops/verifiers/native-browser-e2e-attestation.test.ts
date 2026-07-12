import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '@main/lib/result';
import type { LoopPhaseState } from '@shared/core/loops/loop-phase-state';
import type { LoopSessionTarget, LoopState } from '@shared/core/loops/loop-state';
import type { Loop, LoopPhase, LoopPhaseCriterion } from '@shared/core/loops/loops';
import type { LoopEvidenceRunPort, LoopEvidenceScreenshot } from '../evidence/loop-evidence-store';
import type { LoopExecutionTarget } from '../runtime/loop-execution-target';
import {
  NativeBrowserE2EAttestationService,
  type NativeBrowserE2EAttestationDependencies,
  type NativeBrowserE2EAttestationInput,
} from './native-browser-e2e-attestation';
import type { LoopVerifier } from './types';

const BASE_COMMIT = '1'.repeat(40);
const CHECKPOINT_COMMIT = '2'.repeat(40);
const target: LoopSessionTarget = {
  workspaceId: 'loop-verify-1',
  path: '/tmp/loop-verify-1',
  machine: { kind: 'local' },
};
const taskEnvironment = Object.freeze({
  EMDASH_DEFAULT_BRANCH: 'main',
  EMDASH_PORT: '50100',
  EMDASH_ROOT_PATH: '/tmp/project',
  EMDASH_TASK_ID: 'task-1',
  EMDASH_TASK_NAME: 'Loop task',
  EMDASH_TASK_PATH: target.path,
});
const criteria: LoopPhaseCriterion[] = [
  {
    description: 'The native clean-room preview works.',
    verifier: 'agent-browser',
    status: 'pending',
  },
];
const loopState: LoopState = {
  version: '1',
  baseCommit: BASE_COMMIT,
  expectedFeatureHead: CHECKPOINT_COMMIT,
  checkpointCommit: CHECKPOINT_COMMIT,
  sessionAttempts: [],
  verification: null,
};
const phaseState: LoopPhaseState = {
  version: '2',
  checkpointCommit: CHECKPOINT_COMMIT,
  handoff: null,
  retryHandoffs: [],
  result: null,
};
const loop: Loop = {
  id: 'loop-1',
  projectId: 'project-1',
  taskId: 'task-1',
  name: 'Loop',
  slug: 'loop',
  status: 'running',
  currentPhaseIndex: 2,
  config: {
    version: '2',
    provider: 'codex',
    model: 'gpt-5.6-sol',
    validationCommands: ['pnpm run test'],
    planSource: 'test plan',
    terminalGates: { review: true, e2e: true },
    browserPreview: { enabled: true },
    reviewEnabled: true,
    verifiers: [],
  },
  state: loopState,
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
};
const phase: LoopPhase = {
  id: 'phase-e2e',
  loopId: loop.id,
  idx: 2,
  name: 'E2E',
  goal: 'Verify the complete change.',
  status: 'reviewing',
  attempts: 1,
  conversationId: 'outer-conversation',
  criteria: { version: '1', criteria },
  state: phaseState,
  lastError: null,
  kind: 'e2e',
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
};

function executionTarget(): LoopExecutionTarget {
  return {
    ...target,
    taskEnv: taskEnvironment,
    executionContext: { root: target.path } as never,
    dispose: vi.fn(),
  };
}

function input(): NativeBrowserE2EAttestationInput {
  return {
    loop,
    phase,
    verificationRunId: 'verification-run-1',
    sessionIdentity: {
      attemptId: 'browser-attempt-1',
      conversationId: 'browser-conversation-1',
    },
    outerConversationId: 'outer-conversation',
    target,
    executionTarget: executionTarget(),
    taskEnvironment,
    provider: 'codex',
    model: 'gpt-5.6-sol',
    checkpointCommit: CHECKPOINT_COMMIT,
    criteria,
  };
}

type ProductStatus = 'passed' | 'correctable' | 'failed';

function makeHarness(
  status: ProductStatus,
  options: {
    finish?: LoopEvidenceRunPort['finish'];
    sessionIdentity?: { attemptId: string; conversationId: string };
  } = {}
): {
  service: NativeBrowserE2EAttestationService;
  dependencies: NativeBrowserE2EAttestationDependencies;
  evidenceRun: LoopEvidenceRunPort;
} {
  const evidenceRun: LoopEvidenceRunPort = {
    directory: '/private/app-data/loops/evidence/opaque-run',
    appendObservation: vi.fn(async () => undefined),
    appendIntermediateFailure: vi.fn(async () => undefined),
    appendLeaseRotation: vi.fn(async () => undefined),
    writeScreenshot: vi.fn(
      async (): Promise<LoopEvidenceScreenshot> => ({
        artifactId: 'screenshot-1',
        mimeType: 'image/png',
        byteLength: 128,
        relativePath: 'screenshots/opaque.png',
      })
    ),
    finish: options.finish ?? vi.fn(async () => undefined),
    abandon: vi.fn(async () => undefined),
  };
  const startExactSession = vi.fn<NativeBrowserE2EAttestationDependencies['startExactSession']>(
    async (startInput) =>
      ok({
        attemptId: options.sessionIdentity?.attemptId ?? startInput.sessionIdentity.attemptId,
        conversationId:
          options.sessionIdentity?.conversationId ?? startInput.sessionIdentity.conversationId,
        title: 'Native E2E',
        verificationRunId: startInput.verificationRunId,
        target: startInput.target,
        driver: {
          kind: 'acp',
          startPhaseSession: vi.fn(),
          startVerificationSession: vi.fn(),
          sendPrompt: vi.fn(),
          cancelPrompt: vi.fn(),
        },
      })
  );
  const createVerifier = vi.fn<NativeBrowserE2EAttestationDependencies['createVerifier']>(
    (nativeDependencies): LoopVerifier => ({
      id: 'agent-browser',
      label: 'Native Browser Preview',
      checkAvailability: vi.fn(async () => ok({ available: true })),
      run: vi.fn<LoopVerifier['run']>(async (ctx) => {
        const binding = await nativeDependencies.resolveTrustedBinding({
          loop: ctx.loop,
          phase: ctx.phase,
          signal: ctx.signal ?? new AbortController().signal,
        });
        if (!binding.success) {
          return err({
            kind: 'invalid-config',
            verifierId: 'agent-browser',
            message: binding.error.message,
            cwd: ctx.cwd,
          });
        }
        const run = await nativeDependencies.evidenceStore.beginRun({
          loopId: ctx.loop.id,
          phaseId: ctx.phase.id,
          verificationRunId: binding.data.verificationRunId,
        });
        const session = await nativeDependencies.startVerificationSession({
          loop: ctx.loop,
          phase: ctx.phase,
          verificationRunId: binding.data.verificationRunId,
          target: binding.data.target,
          taskEnvironment: binding.data.taskEnvironment,
          signal: ctx.signal ?? new AbortController().signal,
        });
        if (!session.success) {
          return err({
            kind: 'command-failed',
            verifierId: 'agent-browser',
            message: session.error.message,
            cwd: ctx.cwd,
          });
        }
        await run.writeScreenshot({
          artifactId: 'screenshot-1',
          mimeType: 'image/png',
          data: Buffer.from('sensitive pixels'),
        });
        const evidenceStatus = status === 'correctable' ? 'correction-required' : status;
        const summary =
          status === 'passed'
            ? 'Native preview passed.'
            : status === 'correctable'
              ? 'Fix dialog state. token=must-not-persist'
              : 'Native preview failed.';
        await run.finish({ status: evidenceStatus, summary });
        if (status === 'passed') {
          return ok({
            verifierId: 'agent-browser',
            label: 'Native Browser Preview',
            command: 'ACP native browser verification',
            cwd: ctx.cwd,
            durationMs: 1,
            stdoutTail: '',
            stderrTail: '',
            exitCode: 0,
            summary: 'Native browser criteria passed.',
            evidencePath: run.directory,
          });
        }
        return err({
          kind: 'command-failed',
          verifierId: 'agent-browser',
          message:
            status === 'correctable'
              ? 'Native browser correction is required. See app-data evidence.'
              : 'Native browser criteria failed. See app-data evidence.',
          cwd: ctx.cwd,
          evidencePath: run.directory,
        });
      }),
    })
  );
  const dependencies: NativeBrowserE2EAttestationDependencies = {
    resolveTrustedBinding: vi.fn(async (bindingInput) =>
      ok({
        verificationRunId: 'verification-run-1',
        target,
        taskEnvironment,
        previewServerId: `preview-${bindingInput.phase.id}`,
      })
    ),
    startExactSession,
    browser: {
      start: vi.fn(),
      performAction: vi.fn(),
      reconcilePreview: vi.fn(),
      close: vi.fn(),
    },
    evidenceStore: { beginRun: vi.fn(async () => evidenceRun) },
    createVerifier,
    now: () => new Date('2026-07-12T01:02:03.000Z'),
  };
  return {
    service: new NativeBrowserE2EAttestationService(dependencies),
    dependencies,
    evidenceRun,
  };
}

describe('NativeBrowserE2EAttestationService', () => {
  it.each(['passed', 'correctable', 'failed'] as const)(
    'returns an exact typed %s attestation without persisting evidence paths',
    async (status) => {
      const harness = makeHarness(status);

      const result = await harness.service.run(input());

      expect(result).toMatchObject({
        success: true,
        data: {
          status,
          invocationCount: 1,
          passed: status === 'passed',
          verificationRunId: 'verification-run-1',
          target,
          taskEnvironment,
          provider: 'codex',
          model: 'gpt-5.6-sol',
          checkpointCommit: CHECKPOINT_COMMIT,
          quiescent: true,
          sessionAttempt: {
            attemptId: 'browser-attempt-1',
            conversationId: 'browser-conversation-1',
            purpose: 'browser-verification',
            phaseId: phase.id,
            verificationRunId: 'verification-run-1',
            target,
            status: 'completed',
            checkpointBefore: CHECKPOINT_COMMIT,
            checkpointAfter: CHECKPOINT_COMMIT,
          },
          evidence: {
            runId: 'verification-run-1',
            artifacts: [
              {
                artifactId: 'screenshot-1',
                kind: 'screenshot',
                mimeType: 'image/png',
                byteLength: 128,
              },
            ],
          },
        },
      });
      if (!result.success) throw new Error('Expected a product attestation.');
      expect(result.data.handoff === undefined).toBe(status !== 'correctable');
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('/private/app-data');
      expect(serialized).not.toContain('sensitive pixels');
      expect(serialized).not.toContain('must-not-persist');
    }
  );

  it('passes and verifies the exact preallocated identity through the strict session seam', async () => {
    const harness = makeHarness('passed');
    const runInput = input();

    const result = await harness.service.run(runInput);

    expect(result.success).toBe(true);
    expect(harness.dependencies.startExactSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionIdentity: runInput.sessionIdentity,
        verificationRunId: runInput.verificationRunId,
        target,
        taskEnvironment,
        provider: 'codex',
        model: 'gpt-5.6-sol',
        checkpointCommit: CHECKPOINT_COMMIT,
      })
    );
  });

  it('rejects a session that does not adopt the preallocated identity', async () => {
    const harness = makeHarness('passed', {
      sessionIdentity: { attemptId: 'wrong-attempt', conversationId: 'wrong-conversation' },
    });

    const result = await harness.service.run(input());

    expect(result).toMatchObject({
      success: false,
      error: { type: 'session-authority-invalid', quiescent: true },
    });
    expect(JSON.stringify(result)).not.toContain('wrong-conversation');
  });

  it('does not attest quiescence until evidence finalization settles', async () => {
    const deferred = Promise.withResolvers<void>();
    const harness = makeHarness('passed', { finish: vi.fn(() => deferred.promise) });
    let settled = false;
    const run = harness.service.run(input()).then((result) => {
      settled = true;
      return result;
    });
    await vi.waitFor(() => expect(harness.evidenceRun.finish).toHaveBeenCalledOnce());

    expect(settled).toBe(false);
    deferred.resolve();
    const result = await run;

    expect(result).toMatchObject({ success: true, data: { quiescent: true } });
  });
});
