import { describe, expect, it, vi } from 'vitest';
import type { VerificationActionExecution } from '@main/core/browser/browser-webcontents-registry';
import type {
  NativeBrowserVerificationService,
  NativeBrowserVerificationSession,
} from '@main/core/browser/native-browser-verification-service';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { err, ok, type Result } from '@main/lib/result';
import type { LoopSessionTarget } from '@shared/core/loops/loop-state';
import type { Loop, LoopPhase } from '@shared/core/loops/loops';
import type { LoopSessionDriver } from '../drivers/session-driver';
import type { LoopEvidenceRunPort } from '../evidence/loop-evidence-store';
import type { LoopExecutionTarget } from '../runtime/loop-execution-target';
import {
  createNativeBrowserVerifier,
  NATIVE_BROWSER_CORRECTION_REQUIRED_PREFIX,
  NATIVE_BROWSER_FAILED_PREFIX,
  NATIVE_BROWSER_PASSED_SENTINEL,
  parseNativeBrowserTerminal,
  type NativeBrowserSessionHandle,
  type NativeBrowserVerifierDependencies,
  type TrustedNativeBrowserBinding,
} from './native-browser';
import { NATIVE_BROWSER_ACTION_BEGIN, NATIVE_BROWSER_ACTION_END } from './native-browser-protocol';
import type { VerifierRunContext } from './types';

const LOCAL_TARGET: LoopSessionTarget = {
  workspaceId: 'clean-room-workspace',
  path: '/verification/clean-room',
  machine: { kind: 'local' },
};

const SSH_TARGET: LoopSessionTarget = {
  workspaceId: 'ssh-clean-room',
  path: '/remote/verification/clean-room',
  machine: { kind: 'ssh', connectionId: 'ssh-connection-7' },
};

function taskEnvironment(target: LoopSessionTarget): Readonly<Record<string, string>> {
  return {
    EMDASH_TASK_ID: 'verification-task',
    EMDASH_TASK_NAME: 'env-only-task-name',
    EMDASH_TASK_PATH: target.path,
    EMDASH_ROOT_PATH: target.machine.kind === 'local' ? '/verification' : '/remote/verification',
    EMDASH_DEFAULT_BRANCH: 'main',
    EMDASH_PORT: '5173',
  };
}

function makeLoop(): Loop {
  return {
    id: 'loop-1',
    projectId: 'project-1',
    taskId: 'feature-task',
    name: 'Loop',
    slug: 'loop',
    status: 'running',
    currentPhaseIndex: 0,
    config: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makePhase(): LoopPhase {
  return {
    id: 'phase-1',
    loopId: 'loop-1',
    idx: 0,
    name: 'Browser',
    goal: 'Verify the preview',
    status: 'verifying',
    attempts: 1,
    conversationId: 'outer-conversation',
    criteria: {
      version: '1',
      criteria: [
        {
          description: 'Dashboard is visible',
          verifier: 'agent-browser',
          status: 'verifying',
        },
      ],
    },
    lastError: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function actionBlock(action: unknown): string {
  return `${NATIVE_BROWSER_ACTION_BEGIN}\n${JSON.stringify(action)}\n${NATIVE_BROWSER_ACTION_END}`;
}

function makeDriver(responses: string[]): LoopSessionDriver {
  return {
    kind: 'acp',
    startPhaseSession: vi.fn(async () => ok({ conversationId: 'unused-phase', title: 'unused' })),
    startVerificationSession: vi.fn(async () =>
      ok({ conversationId: 'legacy-fallback', title: 'must not be used' })
    ),
    sendPrompt: vi.fn(async () =>
      ok({ finalText: responses.shift() ?? 'missing scripted response' })
    ),
    cancelPrompt: vi.fn(async () => ok(undefined)),
  };
}

function makeBrowserSession(
  target: LoopSessionTarget,
  patch: Partial<NativeBrowserVerificationSession> = {}
): NativeBrowserVerificationSession {
  const allowedPreviewOrigin =
    target.machine.kind === 'local' ? 'http://localhost:4173' : 'http://127.0.0.1:49222';
  return {
    lease: {
      verificationRunId: 'verify-run',
      browserId: 'browser-1',
      projectId: 'project-1',
      taskId: 'feature-task',
      workspaceId: target.workspaceId,
      partition: 'persist:emdash-browser-loop-verification-profile-1',
      allowedPreviewOrigin,
    },
    previewServerId: 'preview-1',
    previewUrl: `${allowedPreviewOrigin}/dashboard?token=preview-secret#private`,
    ...patch,
  };
}

function makeEvidenceRun(directory = '/app-data/loops/evidence/run'): LoopEvidenceRunPort {
  return {
    directory,
    appendObservation: vi.fn(async () => {}),
    appendIntermediateFailure: vi.fn(async () => {}),
    appendLeaseRotation: vi.fn(async () => {}),
    writeScreenshot: vi.fn(async (input) => ({
      artifactId: input.artifactId,
      mimeType: input.mimeType,
      byteLength: input.data.byteLength,
      relativePath: `screenshots/${input.artifactId}.png`,
    })),
    finish: vi.fn(async () => {}),
    abandon: vi.fn(async () => {}),
  };
}

type HarnessOptions = {
  target?: LoopSessionTarget;
  responses?: string[];
  browserSession?: NativeBrowserVerificationSession;
  evidenceDirectory?: string;
  context?: Partial<VerifierRunContext>;
};

function makeHarness(options: HarnessOptions = {}) {
  const loop = makeLoop();
  const phase = makePhase();
  const target = options.target ?? LOCAL_TARGET;
  const environment = taskEnvironment(target);
  const binding: TrustedNativeBrowserBinding = {
    verificationRunId: 'verify-run',
    target,
    taskEnvironment: environment,
    previewServerId: 'preview-1',
  };
  const nestedDriver = makeDriver(
    options.responses ?? [
      actionBlock({ kind: 'accessibility-snapshot' }),
      NATIVE_BROWSER_PASSED_SENTINEL,
    ]
  );
  const outerDriver = makeDriver([]);
  const browserSession = options.browserSession ?? makeBrowserSession(target);
  const evidenceRun = makeEvidenceRun(options.evidenceDirectory);

  const resolveTrustedBinding = vi.fn<NativeBrowserVerifierDependencies['resolveTrustedBinding']>(
    async () => ok(binding)
  );
  const startVerificationSession = vi.fn<
    NativeBrowserVerifierDependencies['startVerificationSession']
  >(async () =>
    ok({
      verificationRunId: binding.verificationRunId,
      target,
      conversationId: 'nested-conversation',
      title: 'native verification',
      driver: nestedDriver,
    })
  );
  const start = vi.fn<NativeBrowserVerificationService['start']>(async () => ({
    success: true,
    data: browserSession,
  }));
  const performAction = vi.fn<NativeBrowserVerificationService['performAction']>(async () => ({
    result: {
      ok: true,
      observation: {
        kind: 'accessibility-snapshot',
        snapshot: 'Dashboard',
        truncated: false,
      },
    },
  }));
  const reconcilePreview = vi.fn<NativeBrowserVerificationService['reconcilePreview']>(
    async () => ({
      success: false,
      error: { kind: 'lease-closed', message: 'not reconnecting' },
    })
  );
  const close = vi.fn<NativeBrowserVerificationService['close']>(async (lease, reason) => ({
    type: 'closed',
    ...lease,
    reason,
    partitionDataCleared: true,
    closedAt: '2026-01-01T00:00:00.000Z',
  }));
  const beginRun = vi.fn(async () => evidenceRun);
  const setActiveConversation = vi.fn(async () => {});
  const dependencies: NativeBrowserVerifierDependencies = {
    resolveTrustedBinding,
    startVerificationSession,
    browser: { start, performAction, reconcilePreview, close },
    evidenceStore: { beginRun },
    idFactory: () => 'fixed-action-id',
  };
  const ctx: VerifierRunContext = {
    loop,
    phase,
    cwd: '/feature/worktree',
    criteria: phase.criteria!.criteria,
    validationCommands: [],
    sessionDriver: outerDriver,
    executionTarget: fakeExecutionTarget(target, environment),
    promptTimeoutMs: 10_000,
    setActiveConversation,
    ...options.context,
  };
  return {
    binding,
    browserSession,
    close,
    ctx,
    dependencies,
    evidenceRun,
    nestedDriver,
    outerDriver,
    performAction,
    reconcilePreview,
    resolveTrustedBinding,
    setActiveConversation,
    start,
    startVerificationSession,
    target,
    verifier: createNativeBrowserVerifier(dependencies),
  };
}

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

async function waitForCall(mock: { mock: { calls: unknown[][] } }): Promise<void> {
  for (let index = 0; index < 100 && mock.mock.calls.length === 0; index += 1) {
    await Promise.resolve();
  }
  expect(mock.mock.calls.length).toBeGreaterThan(0);
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

function fakeExecutionTarget(
  target: LoopSessionTarget,
  taskEnv: Readonly<Record<string, string>>
): LoopExecutionTarget {
  const executionContext: IExecutionContext = {
    root: target.path,
    supportsLocalSpawn: target.machine.kind === 'local',
    exec: vi.fn(),
    execStreaming: vi.fn(),
    dispose: vi.fn(),
  };
  return { ...target, executionContext, taskEnv, dispose: vi.fn() };
}

describe('native browser verifier', () => {
  it('retains the local target/env and drives one exact native action per ACP turn', async () => {
    const harness = makeHarness();

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(harness.startVerificationSession).toHaveBeenCalledWith({
      loop: harness.ctx.loop,
      phase: harness.ctx.phase,
      verificationRunId: 'verify-run',
      target: LOCAL_TARGET,
      taskEnvironment: taskEnvironment(LOCAL_TARGET),
      signal: expect.any(AbortSignal),
    });
    expect(harness.nestedDriver.startVerificationSession).not.toHaveBeenCalled();
    expect(harness.start).toHaveBeenCalledWith(
      expect.objectContaining({
        verificationRunId: 'verify-run',
        workspaceId: LOCAL_TARGET.workspaceId,
        previewServerId: 'preview-1',
      })
    );
    expect(harness.performAction).toHaveBeenCalledTimes(1);
    expect(harness.performAction).toHaveBeenCalledWith({
      type: 'action',
      ...harness.browserSession.lease,
      actionId: '1-fixed-action-id',
      action: { kind: 'accessibility-snapshot' },
    });
    const prompts = vi.mocked(harness.nestedDriver.sendPrompt).mock.calls.map((call) => call[1]);
    expect(prompts[0]).toContain(LOCAL_TARGET.path);
    expect(prompts[0]).toContain(harness.browserSession.lease.partition);
    expect(prompts.join('\n')).not.toContain('env-only-task-name');
    expect(prompts.join('\n')).not.toContain('preview-secret');
    expect(prompts.join('\n')).not.toContain('#private');
    expect(prompts.join('\n')).not.toContain('agent-browser');
    expect(prompts.join('\n')).not.toContain('MCP');
    expect(harness.close).toHaveBeenCalledWith(harness.browserSession.lease, 'completed');
    expect(harness.evidenceRun.finish).toHaveBeenCalledWith({
      status: 'passed',
      summary: 'Native browser criteria passed',
    });
    expect(harness.setActiveConversation).toHaveBeenNthCalledWith(
      1,
      'nested-conversation',
      harness.nestedDriver
    );
    expect(harness.setActiveConversation).toHaveBeenLastCalledWith(
      'outer-conversation',
      harness.outerDriver
    );
  });

  it('returns only metadata while retaining pass prose in app-data evidence', async () => {
    const privatePageText = 'customer dashboard says renewal amount 7319';
    const harness = makeHarness({
      responses: [
        actionBlock({ kind: 'accessibility-snapshot' }),
        `${privatePageText}\n${NATIVE_BROWSER_PASSED_SENTINEL}`,
      ],
    });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stdoutTail).toBe('');
      expect(result.data.stderrTail).toBe('');
      expect(result.data.summary).toBe(
        'Native browser criteria passed. Sensitive browser evidence is retained in app data.'
      );
      expect(JSON.stringify(result.data)).not.toContain(privatePageText);
    }
    expect(harness.evidenceRun.finish).toHaveBeenCalledWith({
      status: 'passed',
      summary: privatePageText,
    });
  });

  it('retains an SSH target while using only the forwarded local preview origin', async () => {
    const session = makeBrowserSession(SSH_TARGET);
    const harness = makeHarness({
      target: SSH_TARGET,
      browserSession: session,
      responses: [actionBlock({ kind: 'keypress', key: 'Tab' }), NATIVE_BROWSER_PASSED_SENTINEL],
    });
    harness.performAction.mockResolvedValue({
      result: {
        ok: true,
        observation: {
          kind: 'interaction',
          currentUrl: `${session.lease.allowedPreviewOrigin}/settings?token=secret#private`,
        },
      },
    });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(true);
    expect(harness.startVerificationSession).toHaveBeenCalledWith(
      expect.objectContaining({ target: SSH_TARGET, taskEnvironment: taskEnvironment(SSH_TARGET) })
    );
    expect(harness.start).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: SSH_TARGET.workspaceId })
    );
    const prompts = vi.mocked(harness.nestedDriver.sendPrompt).mock.calls.map((call) => call[1]);
    expect(prompts[0]).toContain('ssh-connection-7');
    expect(prompts.join('\n')).toContain('http://127.0.0.1:49222');
    expect(prompts.join('\n')).toContain('/settings');
    expect(prompts.join('\n')).not.toContain('?token=');
    expect(prompts.join('\n')).not.toContain('#private');
    expect(prompts.join('\n')).not.toContain('http://localhost:4173');
  });

  it('rotates a forwarded-origin lease without replaying the destructive action', async () => {
    const initial = makeBrowserSession(SSH_TARGET);
    const rotated: NativeBrowserVerificationSession = {
      lease: {
        ...initial.lease,
        verificationRunId: 'verify-run-rotated',
        browserId: 'browser-rotated',
        partition: 'persist:emdash-browser-loop-verification-profile-rotated',
        allowedPreviewOrigin: 'http://127.0.0.1:49333',
      },
      previewServerId: initial.previewServerId,
      previewUrl: 'http://127.0.0.1:49333/dashboard?secret=value',
    };
    const harness = makeHarness({
      target: SSH_TARGET,
      browserSession: initial,
      responses: [
        actionBlock({ kind: 'click', target: { role: 'button', name: 'Save' } }),
        actionBlock({ kind: 'diagnostics', limit: 5 }),
        NATIVE_BROWSER_PASSED_SENTINEL,
      ],
    });
    harness.performAction
      .mockResolvedValueOnce({
        result: { ok: false, error: { kind: 'not-ready', message: 'preview reconnecting' } },
      })
      .mockResolvedValueOnce({
        result: {
          ok: true,
          observation: { kind: 'diagnostics', entries: [], truncated: false },
        },
      });
    harness.reconcilePreview.mockResolvedValue({
      success: true,
      data: { kind: 'rotated', session: rotated },
    });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(true);
    expect(harness.performAction).toHaveBeenCalledTimes(2);
    expect(harness.performAction.mock.calls[0]![0].action.kind).toBe('click');
    expect(harness.performAction.mock.calls[1]![0].action.kind).toBe('diagnostics');
    expect(harness.performAction.mock.calls[0]![0].actionId).not.toBe(
      harness.performAction.mock.calls[1]![0].actionId
    );
    expect(harness.performAction.mock.calls[1]![0]).toMatchObject(rotated.lease);
    expect(harness.evidenceRun.appendLeaseRotation).toHaveBeenCalledWith({
      previousVerificationRunId: initial.lease.verificationRunId,
      verificationRunId: rotated.lease.verificationRunId,
      previousOrigin: initial.lease.allowedPreviewOrigin,
      allowedPreviewOrigin: rotated.lease.allowedPreviewOrigin,
    });
    const prompts = vi.mocked(harness.nestedDriver.sendPrompt).mock.calls.map((call) => call[1]);
    expect(prompts[1]).toContain('"actionReplayed":false');
    expect(prompts[1]).toContain(rotated.lease.allowedPreviewOrigin);
    expect(prompts[1]).not.toContain('?secret=');
    expect(harness.close).toHaveBeenCalledTimes(2);
    expect(harness.close).toHaveBeenCalledWith(rotated.lease, 'completed');
    expect(harness.close).toHaveBeenCalledWith(initial.lease, 'completed');
  });

  it('requires a fresh successful observation before passing a rotated browser', async () => {
    const initial = makeBrowserSession(SSH_TARGET);
    const rotated: NativeBrowserVerificationSession = {
      lease: {
        ...initial.lease,
        verificationRunId: 'verify-run-fresh-observation',
        browserId: 'browser-fresh-observation',
        partition: 'persist:emdash-browser-loop-verification-profile-fresh-observation',
        allowedPreviewOrigin: 'http://127.0.0.1:49334',
      },
      previewServerId: initial.previewServerId,
      previewUrl: 'http://127.0.0.1:49334/dashboard',
    };
    const harness = makeHarness({
      target: SSH_TARGET,
      browserSession: initial,
      responses: [
        actionBlock({ kind: 'accessibility-snapshot' }),
        actionBlock({ kind: 'keypress', key: 'Tab' }),
        NATIVE_BROWSER_PASSED_SENTINEL,
      ],
    });
    harness.performAction
      .mockResolvedValueOnce({
        result: {
          ok: true,
          observation: {
            kind: 'accessibility-snapshot',
            snapshot: 'old browser observation',
            truncated: false,
          },
        },
      })
      .mockResolvedValueOnce({
        result: { ok: false, error: { kind: 'not-ready', message: 'preview reconnecting' } },
      });
    harness.reconcilePreview.mockResolvedValue({
      success: true,
      data: { kind: 'rotated', session: rotated },
    });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    expect(harness.performAction).toHaveBeenCalledTimes(2);
    expect(harness.performAction.mock.calls[0]![0].action.kind).toBe('accessibility-snapshot');
    expect(harness.performAction.mock.calls[1]![0].action.kind).toBe('keypress');
    expect(harness.evidenceRun.appendIntermediateFailure).toHaveBeenCalledWith({
      kind: 'unobserved-pass',
      message: expect.stringContaining('without a successful browser observation'),
    });
    expect(harness.close).toHaveBeenCalledWith(rotated.lease, 'failed');
    expect(harness.close).toHaveBeenCalledWith(initial.lease, 'failed');
  });

  it('rejects a malformed rotation and still cleans both candidate leases', async () => {
    const harness = makeHarness({
      target: SSH_TARGET,
      responses: [actionBlock({ kind: 'accessibility-snapshot' })],
    });
    const invalidRotation: NativeBrowserVerificationSession = {
      ...makeBrowserSession(SSH_TARGET),
      lease: {
        ...makeBrowserSession(SSH_TARGET).lease,
        verificationRunId: 'rotated-run',
        browserId: 'rotated-browser',
        partition: 'persist:emdash-browser-loop-verification-rotated-profile',
      },
    };
    harness.performAction.mockResolvedValue({
      result: { ok: false, error: { kind: 'not-ready', message: 'reconnecting' } },
    });
    harness.reconcilePreview.mockResolvedValue({
      success: true,
      data: { kind: 'rotated', session: invalidRotation },
    });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toMatch(/reused|changed/i);
    expect(harness.close).toHaveBeenCalledTimes(2);
    expect(harness.close).toHaveBeenCalledWith(invalidRotation.lease, 'failed');
  });

  it('cleans a changed lease mislabeled as resumed', async () => {
    const initial = makeBrowserSession(SSH_TARGET);
    const candidate: NativeBrowserVerificationSession = {
      lease: {
        ...initial.lease,
        verificationRunId: 'mislabeled-run',
        browserId: 'mislabeled-browser',
        partition: 'persist:emdash-browser-loop-verification-mislabeled',
        allowedPreviewOrigin: 'http://127.0.0.1:49444',
      },
      previewServerId: initial.previewServerId,
      previewUrl: 'http://127.0.0.1:49444/dashboard',
    };
    const harness = makeHarness({
      target: SSH_TARGET,
      browserSession: initial,
      responses: [actionBlock({ kind: 'accessibility-snapshot' })],
    });
    harness.performAction.mockResolvedValue({
      result: { ok: false, error: { kind: 'not-ready', message: 'reconnecting' } },
    });
    harness.reconcilePreview.mockResolvedValue({
      success: true,
      data: { kind: 'resumed', session: candidate },
    });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    expect(harness.close).toHaveBeenCalledWith(candidate.lease, 'failed');
    expect(harness.close).toHaveBeenCalledWith(initial.lease, 'failed');
  });

  it('rejects and cleans a resumed session with a changed preview association', async () => {
    const initial = makeBrowserSession(SSH_TARGET);
    const candidate: NativeBrowserVerificationSession = {
      ...initial,
      lease: { ...initial.lease },
      previewServerId: 'changed-preview-association',
    };
    const harness = makeHarness({
      target: SSH_TARGET,
      browserSession: initial,
      responses: [actionBlock({ kind: 'accessibility-snapshot' })],
    });
    harness.performAction.mockResolvedValue({
      result: { ok: false, error: { kind: 'not-ready', message: 'reconnecting' } },
    });
    harness.reconcilePreview.mockResolvedValue({
      success: true,
      data: { kind: 'resumed', session: candidate },
    });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toMatch(/preview identity/i);
    expect(harness.close).toHaveBeenCalledWith(candidate.lease, 'failed');
  });

  it('rejects an unknown reconcile kind and cleans its schema-valid candidate', async () => {
    const initial = makeBrowserSession(SSH_TARGET);
    const candidate: NativeBrowserVerificationSession = {
      lease: {
        ...initial.lease,
        verificationRunId: 'unknown-run',
        browserId: 'unknown-browser',
        partition: 'persist:emdash-browser-loop-verification-unknown',
        allowedPreviewOrigin: 'http://127.0.0.1:49555',
      },
      previewServerId: initial.previewServerId,
      previewUrl: 'http://127.0.0.1:49555/dashboard',
    };
    const harness = makeHarness({
      target: SSH_TARGET,
      browserSession: initial,
      responses: [actionBlock({ kind: 'accessibility-snapshot' })],
    });
    harness.performAction.mockResolvedValue({
      result: { ok: false, error: { kind: 'not-ready', message: 'reconnecting' } },
    });
    harness.reconcilePreview.mockResolvedValue({
      success: true,
      data: { kind: 'unknown', session: candidate },
    } as unknown as Awaited<ReturnType<NativeBrowserVerificationService['reconcilePreview']>>);

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toMatch(/unknown session transition/i);
    expect(harness.close).toHaveBeenCalledWith(candidate.lease, 'failed');
    expect(harness.close).toHaveBeenCalledWith(initial.lease, 'failed');
  });

  it('waits for a late rotated reconcile result and cleans both leases after abort', async () => {
    const controller = new AbortController();
    const initial = makeBrowserSession(SSH_TARGET);
    const rotated: NativeBrowserVerificationSession = {
      lease: {
        ...initial.lease,
        verificationRunId: 'late-rotated-run',
        browserId: 'late-rotated-browser',
        partition: 'persist:emdash-browser-loop-verification-late-rotated',
        allowedPreviewOrigin: 'http://127.0.0.1:49666',
      },
      previewServerId: initial.previewServerId,
      previewUrl: 'http://127.0.0.1:49666/dashboard',
    };
    const harness = makeHarness({
      target: SSH_TARGET,
      browserSession: initial,
      context: { signal: controller.signal },
      responses: [actionBlock({ kind: 'accessibility-snapshot' })],
    });
    const heldReconcile =
      deferred<Awaited<ReturnType<NativeBrowserVerificationService['reconcilePreview']>>>();
    harness.performAction.mockResolvedValue({
      result: { ok: false, error: { kind: 'not-ready', message: 'reconnecting' } },
    });
    harness.reconcilePreview.mockReturnValue(heldReconcile.promise);

    const runPromise = harness.verifier.run(harness.ctx);
    let settled = false;
    void runPromise.then(() => {
      settled = true;
    });
    await waitForCall(harness.reconcilePreview);
    controller.abort();
    await flush();
    expect(settled).toBe(false);
    heldReconcile.resolve({ success: true, data: { kind: 'rotated', session: rotated } });
    const result = await runPromise;

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.kind).toBe('aborted');
    expect(harness.close).toHaveBeenCalledWith(rotated.lease, 'cancelled');
    expect(harness.close).toHaveBeenCalledWith(initial.lease, 'cancelled');
  });

  it.each([
    ['missing end marker', `${NATIVE_BROWSER_ACTION_BEGIN}\n{"kind":"diagnostics"}`],
    [
      'multiple actions',
      `${actionBlock({ kind: 'keypress', key: 'Tab' })}\n${actionBlock({ kind: 'keypress', key: 'Enter' })}`,
    ],
    [
      'arbitrary javascript',
      actionBlock({ kind: 'execute-javascript', script: 'document.cookie' }),
    ],
    [
      'action plus terminal',
      `${actionBlock({ kind: 'diagnostics' })}\n${NATIVE_BROWSER_PASSED_SENTINEL}`,
    ],
  ])('rejects %s without applying an action', async (_label, response) => {
    const harness = makeHarness({ responses: [response] });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    expect(harness.performAction).not.toHaveBeenCalled();
    expect(harness.close).toHaveBeenCalledWith(harness.browserSession.lease, 'failed');
    expect(harness.evidenceRun.finish).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('repairs one multi-action turn without executing it and accepts a later terminal outcome', async () => {
    const harness = makeHarness({
      responses: [
        actionBlock({ kind: 'accessibility-snapshot' }),
        `${actionBlock({ kind: 'keypress', key: 'Tab' })}\n${actionBlock({
          kind: 'keypress',
          key: 'Enter',
        })}`,
        NATIVE_BROWSER_PASSED_SENTINEL,
      ],
    });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(harness.performAction).toHaveBeenCalledTimes(1);
    expect(harness.evidenceRun.appendIntermediateFailure).toHaveBeenCalledWith({
      kind: 'protocol-repair',
      message: 'Rejected native verifier protocol turn 1 without executing an action',
    });
    const prompts = vi.mocked(harness.nestedDriver.sendPrompt).mock.calls.map((call) => call[1]);
    expect(prompts[2]).toContain('Protocol repair 1 of 2');
    expect(prompts[2]).toContain('return exactly one allowlisted action block');
  });

  it('parses only one safe terminal sentinel on the final line', () => {
    expect(parseNativeBrowserTerminal(NATIVE_BROWSER_PASSED_SENTINEL)).toEqual({ kind: 'passed' });
    expect(
      parseNativeBrowserTerminal(`${NATIVE_BROWSER_FAILED_PREFIX} observed failure>>>`)
    ).toEqual({ kind: 'failed', reason: 'observed failure' });
    expect(
      parseNativeBrowserTerminal(`${NATIVE_BROWSER_CORRECTION_REQUIRED_PREFIX} fix the dialog>>>`)
    ).toEqual({ kind: 'correction-required', summary: 'fix the dialog' });
    expect(
      parseNativeBrowserTerminal(`${NATIVE_BROWSER_PASSED_SENTINEL}\ntrailing claim`)
    ).toBeNull();
    expect(
      parseNativeBrowserTerminal(
        `${NATIVE_BROWSER_FAILED_PREFIX} one>>>\n${NATIVE_BROWSER_PASSED_SENTINEL}`
      )
    ).toBeNull();
    expect(parseNativeBrowserTerminal(`${NATIVE_BROWSER_FAILED_PREFIX} >>>`)).toBeNull();
  });

  it('rejects a pass before any successful browser observation', async () => {
    const harness = makeHarness({ responses: [NATIVE_BROWSER_PASSED_SENTINEL] });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    expect(harness.evidenceRun.appendIntermediateFailure).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'unobserved-pass' })
    );
  });

  it.each([
    ['missing target', { target: undefined }],
    ['missing environment', { taskEnvironment: undefined }],
    [
      'secret-bearing environment key',
      {
        taskEnvironment: {
          ...taskEnvironment(LOCAL_TARGET),
          EMDASH_HOOK_TOKEN: 'secret',
        },
      },
    ],
  ])('fails closed on %s before browser/session creation', async (_label, patch) => {
    const harness = makeHarness();
    harness.resolveTrustedBinding.mockResolvedValue(
      ok({ ...harness.binding, ...patch } as unknown as TrustedNativeBrowserBinding)
    );

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    expect(harness.start).not.toHaveBeenCalled();
    expect(harness.startVerificationSession).not.toHaveBeenCalled();
  });

  it('requires exact execution-target identity and trusted environment equality', async () => {
    const harness = makeHarness();
    harness.ctx.executionTarget = fakeExecutionTarget(LOCAL_TARGET, {
      ...taskEnvironment(LOCAL_TARGET),
      EMDASH_PORT: '9999',
    });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.message).toMatch(/authoritative verifier environment/i);
    expect(harness.start).not.toHaveBeenCalled();
  });

  it('rejects a missing authoritative execution target before evidence, browser, or ACP startup', async () => {
    const harness = makeHarness({ context: { executionTarget: undefined } });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toMatch(/authoritative execution target/i);
    expect(harness.dependencies.evidenceStore.beginRun).not.toHaveBeenCalled();
    expect(harness.start).not.toHaveBeenCalled();
    expect(harness.startVerificationSession).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong run', { verificationRunId: 'other-run' }],
    ['wrong target', { target: { ...LOCAL_TARGET, workspaceId: 'feature-workspace' } }],
    ['reused outer conversation', { conversationId: 'outer-conversation' }],
  ])('rejects a nested session with %s and closes its browser lease', async (_label, patch) => {
    const harness = makeHarness();
    harness.startVerificationSession.mockResolvedValue(
      ok({
        verificationRunId: 'verify-run',
        target: LOCAL_TARGET,
        conversationId: 'nested-conversation',
        title: 'native verification',
        driver: harness.nestedDriver,
        ...patch,
      } as NativeBrowserSessionHandle)
    );

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    expect(harness.close).toHaveBeenCalledWith(harness.browserSession.lease, 'failed');
  });

  it('rejects a non-ACP nested driver and a changed preview association', async () => {
    const harness = makeHarness();
    const ptyDriver: LoopSessionDriver = { ...harness.nestedDriver, kind: 'pty' };
    harness.startVerificationSession.mockResolvedValue(
      ok({
        verificationRunId: 'verify-run',
        target: LOCAL_TARGET,
        conversationId: 'nested-conversation',
        title: 'native verification',
        driver: ptyDriver,
      })
    );

    const driverResult = await harness.verifier.run(harness.ctx);

    expect(driverResult.success).toBe(false);

    const previewHarness = makeHarness({
      browserSession: { ...makeBrowserSession(LOCAL_TARGET), previewServerId: 'other-preview' },
    });
    const previewResult = await previewHarness.verifier.run(previewHarness.ctx);
    expect(previewResult.success).toBe(false);
    expect(previewHarness.startVerificationSession).not.toHaveBeenCalled();
    expect(previewHarness.close).toHaveBeenCalledWith(
      previewHarness.browserSession.lease,
      'failed'
    );
  });

  it('cleans a schema-valid started lease whose identity does not match the requested workspace', async () => {
    const wrongIdentitySession = makeBrowserSession(LOCAL_TARGET);
    wrongIdentitySession.lease = {
      ...wrongIdentitySession.lease,
      workspaceId: 'unrelated-workspace',
    };
    const harness = makeHarness({ browserSession: wrongIdentitySession });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    expect(harness.startVerificationSession).not.toHaveBeenCalled();
    expect(harness.close).toHaveBeenCalledWith(wrongIdentitySession.lease, 'failed');
  });

  it('rejects criteria overflow before resolving any external authority', async () => {
    const harness = makeHarness();
    harness.ctx.criteria = Array.from({ length: 65 }, (_, index) => ({
      description: `criterion ${index}`,
      verifier: 'agent-browser' as const,
      status: 'verifying' as const,
    }));

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    expect(harness.resolveTrustedBinding).not.toHaveBeenCalled();
  });

  it('cancels a held prompt and cleans the lease/evidence', async () => {
    const controller = new AbortController();
    const harness = makeHarness({ context: { signal: controller.signal } });
    const heldPrompt =
      deferred<Result<{ finalText: string }, { kind: 'prompt-failed'; message: string }>>();
    const heldCancellation = deferred<Result<void, { kind: 'cancel-failed'; message: string }>>();
    harness.nestedDriver.sendPrompt = vi.fn(() => heldPrompt.promise);
    harness.nestedDriver.cancelPrompt = vi.fn(() => heldCancellation.promise);

    const runPromise = harness.verifier.run(harness.ctx);
    let settled = false;
    void runPromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await waitForCall(vi.mocked(harness.nestedDriver.sendPrompt));
    controller.abort();
    await waitForCall(vi.mocked(harness.nestedDriver.cancelPrompt));
    heldPrompt.resolve(ok({ finalText: 'late response must never be interpreted' }));
    await flush();
    expect(settled).toBe(false);
    expect(harness.performAction).not.toHaveBeenCalled();
    heldCancellation.resolve(ok(undefined));
    const result = await runPromise;

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.kind).toBe('aborted');
    expect(harness.nestedDriver.cancelPrompt).toHaveBeenCalledWith('nested-conversation');
    expect(harness.close).toHaveBeenCalledWith(harness.browserSession.lease, 'cancelled');
    expect(harness.evidenceRun.finish).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled' })
    );
  });

  it.each(['typed-error', 'throw'] as const)(
    'quiesces the held prompt and surfaces %s from in-flight ACP cancellation',
    async (mode) => {
      const controller = new AbortController();
      const harness = makeHarness({ context: { signal: controller.signal } });
      const heldPrompt =
        deferred<Result<{ finalText: string }, { kind: 'prompt-failed'; message: string }>>();
      harness.nestedDriver.sendPrompt = vi.fn(() => heldPrompt.promise);
      if (mode === 'typed-error') {
        harness.nestedDriver.cancelPrompt = vi.fn(async () =>
          err({ kind: 'cancel-failed' as const, message: 'in-flight cancellation refused' })
        );
      } else {
        harness.nestedDriver.cancelPrompt = vi.fn(() => {
          throw new Error('in-flight cancellation threw');
        });
      }

      const runPromise = harness.verifier.run(harness.ctx);
      let settled = false;
      void runPromise.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );
      await waitForCall(vi.mocked(harness.nestedDriver.sendPrompt));
      controller.abort();
      await waitForCall(vi.mocked(harness.nestedDriver.cancelPrompt));
      await flush();
      expect(settled).toBe(false);

      heldPrompt.resolve(err({ kind: 'prompt-failed', message: 'prompt quiesced' }));
      const result = await runPromise;

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.kind).toBe('execution-error');
        expect(result.error.message).toContain('Native browser verification was cancelled');
        expect(result.error.message).toContain(
          mode === 'typed-error' ? 'in-flight cancellation refused' : 'in-flight cancellation threw'
        );
      }
      expect(harness.close).toHaveBeenCalledWith(harness.browserSession.lease, 'cancelled');
      expect(harness.evidenceRun.finish).toHaveBeenCalledWith({
        status: 'cancelled',
        summary: expect.stringContaining('Cleanup recovery required'),
      });
    }
  );

  it('latches caller cancellation while delayed quiescence crosses the timeout', async () => {
    const controller = new AbortController();
    const harness = makeHarness({
      context: { signal: controller.signal, promptTimeoutMs: 5 },
    });
    const heldPrompt =
      deferred<Result<{ finalText: string }, { kind: 'prompt-failed'; message: string }>>();
    const heldCancellation = deferred<Result<void, { kind: 'cancel-failed'; message: string }>>();
    harness.nestedDriver.sendPrompt = vi.fn(() => heldPrompt.promise);
    harness.nestedDriver.cancelPrompt = vi.fn(() => heldCancellation.promise);

    const runPromise = harness.verifier.run(harness.ctx);
    await waitForCall(vi.mocked(harness.nestedDriver.sendPrompt));
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 15));
    heldPrompt.resolve(err({ kind: 'prompt-failed', message: 'cancelled' }));
    heldCancellation.resolve(ok(undefined));
    const result = await runPromise;

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.kind).toBe('aborted');
  });

  it('times out a held prompt and performs the same deterministic cleanup', async () => {
    const harness = makeHarness({ context: { promptTimeoutMs: 5 } });
    const heldPrompt =
      deferred<Result<{ finalText: string }, { kind: 'prompt-failed'; message: string }>>();
    harness.nestedDriver.sendPrompt = vi.fn(() => heldPrompt.promise);
    harness.nestedDriver.cancelPrompt = vi.fn(async () => {
      heldPrompt.resolve(err({ kind: 'prompt-failed', message: 'cancelled' }));
      return ok(undefined);
    });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.kind).toBe('timed-out');
    expect(harness.nestedDriver.cancelPrompt).toHaveBeenCalled();
    expect(harness.close).toHaveBeenCalledWith(harness.browserSession.lease, 'cancelled');
  });

  it('waits for an in-flight Electron action to quiesce after cancellation', async () => {
    const controller = new AbortController();
    const harness = makeHarness({
      context: { signal: controller.signal },
      responses: [actionBlock({ kind: 'click', target: { role: 'button', name: 'Save' } })],
    });
    const heldAction = deferred<VerificationActionExecution>();
    harness.performAction.mockReturnValue(heldAction.promise);

    const runPromise = harness.verifier.run(harness.ctx);
    let settled = false;
    void runPromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await waitForCall(harness.performAction);
    controller.abort();
    await flush();
    expect(settled).toBe(false);
    expect(harness.close).toHaveBeenCalledWith(harness.browserSession.lease, 'cancelled');
    heldAction.resolve({
      result: {
        ok: true,
        observation: {
          kind: 'interaction',
          currentUrl: 'http://localhost:4173/late-mutation',
        },
      },
    });
    const result = await runPromise;

    expect(result.success).toBe(false);
    expect(harness.evidenceRun.appendObservation).not.toHaveBeenCalled();
    expect(vi.mocked(harness.nestedDriver.sendPrompt)).toHaveBeenCalledTimes(1);
  });

  it('waits for a held evidence append and surfaces its late cleanup failure', async () => {
    const controller = new AbortController();
    const harness = makeHarness({
      context: { signal: controller.signal },
      responses: [
        actionBlock({ kind: 'accessibility-snapshot' }),
        `${NATIVE_BROWSER_FAILED_PREFIX} observed failure>>>`,
      ],
    });
    const heldAppend = deferred<void>();
    vi.mocked(harness.evidenceRun.appendIntermediateFailure).mockReturnValue(heldAppend.promise);

    const runPromise = harness.verifier.run(harness.ctx);
    let settled = false;
    void runPromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await waitForCall(vi.mocked(harness.evidenceRun.appendIntermediateFailure));
    controller.abort();
    await flush();
    expect(settled).toBe(false);
    heldAppend.reject(
      new AggregateError(
        [new Error('event unlink failed')],
        'metadata failed; cleanup failed: event unlink failed'
      )
    );
    const result = await runPromise;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.kind).toBe('execution-error');
      expect(result.error.message).toContain('metadata failed');
      expect(result.error.message).toContain('event unlink failed');
    }
    expect(harness.evidenceRun.finish).toHaveBeenCalledWith({
      status: 'cancelled',
      summary: expect.stringContaining('Cleanup recovery required'),
    });
  });

  it('waits for a held screenshot write and surfaces its late artifact cleanup failure', async () => {
    const controller = new AbortController();
    const harness = makeHarness({
      context: { signal: controller.signal },
      responses: [actionBlock({ kind: 'screenshot' })],
    });
    const pixels = Buffer.from('sensitive pixels');
    harness.performAction.mockResolvedValue({
      result: {
        ok: true,
        observation: {
          kind: 'screenshot',
          artifact: {
            artifactId: 'held-shot',
            mimeType: 'image/png',
            byteLength: pixels.byteLength,
          },
        },
      },
      screenshot: { artifactId: 'held-shot', mimeType: 'image/png', data: pixels },
    });
    const heldScreenshot = deferred<Awaited<ReturnType<LoopEvidenceRunPort['writeScreenshot']>>>();
    vi.mocked(harness.evidenceRun.writeScreenshot).mockReturnValue(heldScreenshot.promise);

    const runPromise = harness.verifier.run(harness.ctx);
    let settled = false;
    void runPromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await waitForCall(vi.mocked(harness.evidenceRun.writeScreenshot));
    controller.abort();
    await flush();
    expect(settled).toBe(false);
    heldScreenshot.reject(
      new AggregateError(
        [new Error('artifact unlink failed')],
        'screenshot write failed; cleanup failed: artifact unlink failed'
      )
    );
    const result = await runPromise;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.kind).toBe('execution-error');
      expect(result.error.message).toContain('screenshot write failed');
      expect(result.error.message).toContain('artifact unlink failed');
    }
    expect(harness.evidenceRun.appendObservation).not.toHaveBeenCalled();
    expect(harness.evidenceRun.finish).toHaveBeenCalledWith({
      status: 'cancelled',
      summary: expect.stringContaining('Cleanup recovery required'),
    });
  });

  it('closes the browser when the nested ACP session fails early', async () => {
    const harness = makeHarness();
    harness.startVerificationSession.mockResolvedValue(
      err({ kind: 'create-failed', message: 'ACP runtime unavailable' })
    );

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toBe('ACP runtime unavailable');
    expect(harness.close).toHaveBeenCalledWith(harness.browserSession.lease, 'failed');
  });

  it('finishes evidence that resolves after cancellation without leaking authority', async () => {
    const controller = new AbortController();
    const harness = makeHarness({ context: { signal: controller.signal } });
    const lateEvidence = makeEvidenceRun('/app-data/loops/evidence/late');
    const heldEvidence = deferred<LoopEvidenceRunPort>();
    const beginRun = vi.fn(() => heldEvidence.promise);
    harness.dependencies.evidenceStore.beginRun = beginRun;
    const verifier = createNativeBrowserVerifier(harness.dependencies);

    const runPromise = verifier.run(harness.ctx);
    let settled = false;
    void runPromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await waitForCall(beginRun);
    controller.abort();
    await flush();
    expect(settled).toBe(false);
    heldEvidence.resolve(lateEvidence);
    const result = await runPromise;

    expect(result.success).toBe(false);
    expect(lateEvidence.finish).toHaveBeenCalledWith({
      status: 'cancelled',
      summary: 'Verification cancelled before evidence start',
    });
    expect(harness.start).not.toHaveBeenCalled();
  });

  it('retries transient late evidence finalization failure while preserving cancellation', async () => {
    const controller = new AbortController();
    const harness = makeHarness({ context: { signal: controller.signal } });
    const lateEvidence = makeEvidenceRun('/app-data/loops/evidence/late-failure');
    vi.mocked(lateEvidence.finish)
      .mockRejectedValueOnce(new Error('late evidence finish failed'))
      .mockResolvedValueOnce(undefined);
    const heldEvidence = deferred<LoopEvidenceRunPort>();
    const beginRun = vi.fn(() => heldEvidence.promise);
    harness.dependencies.evidenceStore.beginRun = beginRun;
    const verifier = createNativeBrowserVerifier(harness.dependencies);

    const runPromise = verifier.run(harness.ctx);
    await waitForCall(beginRun);
    controller.abort();
    heldEvidence.resolve(lateEvidence);
    const result = await runPromise;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.kind).toBe('aborted');
      expect(result.error.message).toBe('Native browser verification was cancelled');
    }
    expect(lateEvidence.finish).toHaveBeenCalledTimes(2);
    expect(lateEvidence.finish).toHaveBeenLastCalledWith({
      status: 'cancelled',
      summary: 'Native browser verification was cancelled',
    });
    expect(lateEvidence.abandon).not.toHaveBeenCalled();
    expect(harness.start).not.toHaveBeenCalled();
  });

  it('surfaces persistent late evidence finalization failure as cleanup recovery', async () => {
    const controller = new AbortController();
    const harness = makeHarness({ context: { signal: controller.signal } });
    const lateEvidence = makeEvidenceRun('/app-data/loops/evidence/late-persistent-failure');
    vi.mocked(lateEvidence.finish).mockRejectedValue(new Error('evidence authority remained open'));
    const heldEvidence = deferred<LoopEvidenceRunPort>();
    const beginRun = vi.fn(() => heldEvidence.promise);
    harness.dependencies.evidenceStore.beginRun = beginRun;
    const verifier = createNativeBrowserVerifier(harness.dependencies);

    const runPromise = verifier.run(harness.ctx);
    await waitForCall(beginRun);
    controller.abort();
    heldEvidence.resolve(lateEvidence);
    const result = await runPromise;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.kind).toBe('execution-error');
      expect(result.error.message).toContain('Native browser verification was cancelled');
      expect(result.error.message).toContain('evidence authority remained open');
    }
    expect(lateEvidence.finish).toHaveBeenCalledTimes(2);
    expect(lateEvidence.abandon).toHaveBeenCalledTimes(1);
    expect(harness.start).not.toHaveBeenCalled();
  });

  it('closes a browser lease that starts after cancellation', async () => {
    const controller = new AbortController();
    const harness = makeHarness({ context: { signal: controller.signal } });
    const heldStart = deferred<Awaited<ReturnType<NativeBrowserVerificationService['start']>>>();
    harness.start.mockReturnValue(heldStart.promise);

    const runPromise = harness.verifier.run(harness.ctx);
    let settled = false;
    void runPromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await waitForCall(harness.start);
    controller.abort();
    await flush();
    expect(settled).toBe(false);
    heldStart.resolve({ success: true, data: harness.browserSession });
    const result = await runPromise;

    expect(result.success).toBe(false);
    expect(harness.close).toHaveBeenCalledWith(harness.browserSession.lease, 'cancelled');
  });

  it.each(['incomplete', 'throw'] as const)(
    'surfaces %s cleanup for a browser lease that starts after cancellation',
    async (mode) => {
      const controller = new AbortController();
      const harness = makeHarness({ context: { signal: controller.signal } });
      const heldStart = deferred<Awaited<ReturnType<NativeBrowserVerificationService['start']>>>();
      harness.start.mockReturnValue(heldStart.promise);
      if (mode === 'throw') {
        harness.close.mockRejectedValue(new Error('late close threw'));
      } else {
        harness.close.mockImplementation(async (lease, reason) => ({
          type: 'closed',
          ...lease,
          reason,
          partitionDataCleared: false,
          cleanupError: 'late partition remained',
          closedAt: '2026-01-01T00:00:00.000Z',
        }));
      }

      const runPromise = harness.verifier.run(harness.ctx);
      await waitForCall(harness.start);
      controller.abort();
      heldStart.resolve({ success: true, data: harness.browserSession });
      const result = await runPromise;

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.kind).toBe('execution-error');
        expect(result.error.message).toContain('cancelled');
        expect(result.error.message).toContain(
          mode === 'throw' ? 'late close threw' : 'late partition remained'
        );
      }
      expect(harness.evidenceRun.finish).toHaveBeenCalledWith({
        status: 'cancelled',
        summary: expect.stringContaining('Cleanup recovery required'),
      });
    }
  );

  it('cancels a nested session that starts after cancellation', async () => {
    const controller = new AbortController();
    const harness = makeHarness({ context: { signal: controller.signal } });
    const heldSession =
      deferred<
        Awaited<ReturnType<NativeBrowserVerifierDependencies['startVerificationSession']>>
      >();
    harness.startVerificationSession.mockReturnValue(heldSession.promise);

    const runPromise = harness.verifier.run(harness.ctx);
    let settled = false;
    void runPromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await waitForCall(harness.startVerificationSession);
    controller.abort();
    await flush();
    expect(settled).toBe(false);
    heldSession.resolve(
      ok({
        verificationRunId: 'verify-run',
        target: LOCAL_TARGET,
        conversationId: 'late-conversation',
        title: 'late session',
        driver: harness.nestedDriver,
      })
    );
    const result = await runPromise;

    expect(result.success).toBe(false);
    expect(harness.nestedDriver.cancelPrompt).toHaveBeenCalledWith('late-conversation');
    expect(harness.close).toHaveBeenCalledWith(harness.browserSession.lease, 'cancelled');
  });

  it.each(['typed-error', 'throw'] as const)(
    'surfaces %s from late nested-session cancellation as cleanup recovery',
    async (mode) => {
      const controller = new AbortController();
      const harness = makeHarness({ context: { signal: controller.signal } });
      const heldSession =
        deferred<
          Awaited<ReturnType<NativeBrowserVerifierDependencies['startVerificationSession']>>
        >();
      harness.startVerificationSession.mockReturnValue(heldSession.promise);
      if (mode === 'typed-error') {
        harness.nestedDriver.cancelPrompt = vi.fn(async () =>
          err({ kind: 'cancel-failed' as const, message: 'late cancellation refused' })
        );
      } else {
        harness.nestedDriver.cancelPrompt = vi.fn(() => {
          throw new Error('late cancellation threw');
        });
      }

      const runPromise = harness.verifier.run(harness.ctx);
      await waitForCall(harness.startVerificationSession);
      controller.abort();
      heldSession.resolve(
        ok({
          verificationRunId: 'verify-run',
          target: LOCAL_TARGET,
          conversationId: 'late-conversation',
          title: 'late session',
          driver: harness.nestedDriver,
        })
      );
      const result = await runPromise;

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.kind).toBe('execution-error');
        expect(result.error.message).toMatch(/cancel/i);
        expect(result.error.message).toContain(
          mode === 'typed-error' ? 'late cancellation refused' : 'late cancellation threw'
        );
      }
      expect(harness.close).toHaveBeenCalledWith(harness.browserSession.lease, 'cancelled');
      expect(harness.evidenceRun.finish).toHaveBeenCalledWith({
        status: 'cancelled',
        summary: expect.stringContaining('Cleanup recovery required'),
      });
    }
  );

  it('compensates a late nested activation so the outer conversation remains authoritative', async () => {
    const controller = new AbortController();
    const harness = makeHarness({ context: { signal: controller.signal } });
    const activation = deferred<void>();
    let activeConversation = 'outer-conversation';
    let activationCalls = 0;
    harness.ctx.setActiveConversation = vi.fn(async (conversationId) => {
      activationCalls += 1;
      if (activationCalls === 1) {
        try {
          await activation.promise;
        } finally {
          activeConversation = conversationId ?? 'none';
        }
        return;
      }
      activeConversation = conversationId ?? 'none';
    });

    const runPromise = harness.verifier.run(harness.ctx);
    let settled = false;
    void runPromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await waitForCall(vi.mocked(harness.ctx.setActiveConversation));
    controller.abort();
    await flush();
    expect(settled).toBe(false);
    activation.reject(new Error('mutated then rejected'));
    const result = await runPromise;

    expect(result.success).toBe(false);
    expect(activeConversation).toBe('outer-conversation');
    expect(vi.mocked(harness.ctx.setActiveConversation).mock.calls.length).toBeGreaterThanOrEqual(
      3
    );
  });

  it('does not start a prompt when cancellation lands after activation resolves', async () => {
    const controller = new AbortController();
    const harness = makeHarness({ context: { signal: controller.signal } });
    let activationCalls = 0;
    harness.ctx.setActiveConversation = vi.fn((): Promise<void> => {
      activationCalls += 1;
      if (activationCalls > 1) return Promise.resolve();
      return {
        then(onFulfilled: (value: void) => unknown) {
          onFulfilled(undefined);
          queueMicrotask(() => controller.abort());
        },
      } as unknown as Promise<void>;
    });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.kind).toBe('aborted');
    expect(harness.nestedDriver.sendPrompt).not.toHaveBeenCalled();
    expect(harness.nestedDriver.cancelPrompt).not.toHaveBeenCalled();
    expect(harness.close).toHaveBeenCalledWith(harness.browserSession.lease, 'cancelled');
    expect(harness.evidenceRun.finish).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled' })
    );
  });

  it('bounds and redacts snapshots, diagnostics, and observed URLs before the next ACP turn', async () => {
    const harness = makeHarness({
      responses: [
        actionBlock({ kind: 'accessibility-snapshot' }),
        actionBlock({ kind: 'diagnostics', limit: 5 }),
        actionBlock({ kind: 'keypress', key: 'Tab' }),
        NATIVE_BROWSER_PASSED_SENTINEL,
      ],
    });
    harness.performAction
      .mockResolvedValueOnce({
        result: {
          ok: true,
          observation: {
            kind: 'accessibility-snapshot',
            snapshot:
              'token=super-secret file:///home/devuser/private data:text/plain,secret ' +
              'javascript:alert(secret)\nAccept cookies to continue\n' +
              'Set-Cookie: sessionid=snapshot-cookie-secret',
            truncated: false,
          },
        },
      })
      .mockResolvedValueOnce({
        result: {
          ok: true,
          observation: {
            kind: 'diagnostics',
            entries: [
              {
                level: 'error',
                source: 'network',
                message:
                  'authorization=BearerSecret file:///etc/passwd\n' +
                  'cookie=diagnostic-cookie-secret',
                redacted: true,
              },
              {
                level: 'error',
                source: 'network',
                message:
                  '{"cookies"         : [\n' +
                  '"opaque-value-7319",\n' +
                  '{"nested":"opaque-value-8427"}\n]}',
                redacted: true,
              },
              {
                level: 'error',
                source: 'network',
                message: String.raw`{\\"set-cookie\\"         : {
\\"nested\\":\\"opaque-value-9538\\"
}}`,
                redacted: true,
              },
              {
                level: 'info',
                source: 'console',
                message: 'Accept cookies to continue',
                redacted: true,
              },
            ],
            truncated: false,
          },
        },
      })
      .mockResolvedValueOnce({
        result: {
          ok: true,
          observation: {
            kind: 'interaction',
            currentUrl: 'http://localhost:4173/account?token=secret#private',
          },
        },
      });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(true);
    const prompts = vi
      .mocked(harness.nestedDriver.sendPrompt)
      .mock.calls.map((call) => call[1])
      .join('\n');
    expect(prompts).toContain('[REDACTED]');
    expect(prompts).toContain('/account');
    expect(prompts).not.toContain('super-secret');
    expect(prompts).not.toContain('BearerSecret');
    expect(prompts).not.toContain('snapshot-cookie-secret');
    expect(prompts).not.toContain('diagnostic-cookie-secret');
    expect(prompts).not.toContain('opaque-value-7319');
    expect(prompts).not.toContain('opaque-value-8427');
    expect(prompts).not.toContain('opaque-value-9538');
    expect(prompts).toContain('Accept cookies to continue');
    expect(prompts).toContain('Diagnostics are the final inspection step');
    expect(prompts).not.toContain('file:///');
    expect(prompts).not.toContain('data:text');
    expect(prompts).not.toContain('javascript:');
    expect(prompts).not.toContain('?token=');
    expect(prompts).not.toContain('#private');
    expect(harness.evidenceRun.appendObservation).toHaveBeenCalledTimes(3);
    const evidenceCalls = JSON.stringify(
      vi.mocked(harness.evidenceRun.appendObservation).mock.calls
    );
    expect(evidenceCalls).not.toContain('snapshot-cookie-secret');
    expect(evidenceCalls).not.toContain('diagnostic-cookie-secret');
    expect(evidenceCalls).not.toContain('opaque-value-7319');
    expect(evidenceCalls).not.toContain('opaque-value-8427');
    expect(evidenceCalls).not.toContain('opaque-value-9538');
    expect(evidenceCalls).toContain('Accept cookies to continue');
  });

  it('stores screenshot bytes only as a sensitive app-data artifact', async () => {
    const harness = makeHarness({
      responses: [
        actionBlock({ kind: 'screenshot', label: 'private view' }),
        NATIVE_BROWSER_PASSED_SENTINEL,
      ],
    });
    const pixels = Buffer.from('raw-sensitive-pixels');
    harness.performAction.mockResolvedValue({
      result: {
        ok: true,
        observation: {
          kind: 'screenshot',
          artifact: { artifactId: 'shot-1', mimeType: 'image/png', byteLength: pixels.byteLength },
        },
      },
      screenshot: { artifactId: 'shot-1', mimeType: 'image/png', data: pixels },
    });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(true);
    expect(harness.evidenceRun.writeScreenshot).toHaveBeenCalledWith({
      artifactId: 'shot-1',
      mimeType: 'image/png',
      data: pixels,
    });
    const prompts = vi
      .mocked(harness.nestedDriver.sendPrompt)
      .mock.calls.map((call) => call[1])
      .join('\n');
    expect(prompts).toContain('shot-1');
    expect(prompts).not.toContain('raw-sensitive-pixels');
    expect(prompts).not.toContain('screenshots/shot-1.png');
  });

  it('returns an ordinary screenshot failure to ACP without requiring artifact bytes', async () => {
    const harness = makeHarness({
      responses: [
        actionBlock({ kind: 'screenshot' }),
        `${NATIVE_BROWSER_FAILED_PREFIX} screenshot capture failed>>>`,
      ],
    });
    harness.performAction.mockResolvedValue({
      result: {
        ok: false,
        error: { kind: 'artifact-failed', message: 'screenshot was empty' },
      },
    });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe('Native browser criteria failed. See app-data evidence.');
    }
    expect(harness.evidenceRun.writeScreenshot).not.toHaveBeenCalled();
    expect(vi.mocked(harness.nestedDriver.sendPrompt).mock.calls[1]![1]).toContain(
      'artifact-failed'
    );
  });

  it('reconciles screenshot not-ready without bytes and rotates without replay', async () => {
    const initial = makeBrowserSession(SSH_TARGET);
    const rotated: NativeBrowserVerificationSession = {
      lease: {
        ...initial.lease,
        verificationRunId: 'screenshot-rotated-run',
        browserId: 'screenshot-rotated-browser',
        partition: 'persist:emdash-browser-loop-verification-screenshot-rotated',
        allowedPreviewOrigin: 'http://127.0.0.1:49777',
      },
      previewServerId: initial.previewServerId,
      previewUrl: 'http://127.0.0.1:49777/dashboard',
    };
    const harness = makeHarness({
      target: SSH_TARGET,
      browserSession: initial,
      responses: [
        actionBlock({ kind: 'screenshot' }),
        actionBlock({ kind: 'diagnostics', limit: 5 }),
        NATIVE_BROWSER_PASSED_SENTINEL,
      ],
    });
    harness.performAction
      .mockResolvedValueOnce({
        result: { ok: false, error: { kind: 'not-ready', message: 'reconnecting' } },
      })
      .mockResolvedValueOnce({
        result: {
          ok: true,
          observation: { kind: 'diagnostics', entries: [], truncated: false },
        },
      });
    harness.reconcilePreview.mockResolvedValue({
      success: true,
      data: { kind: 'rotated', session: rotated },
    });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(true);
    expect(harness.evidenceRun.writeScreenshot).not.toHaveBeenCalled();
    expect(harness.performAction).toHaveBeenCalledTimes(2);
    expect(harness.performAction.mock.calls[0]![0].action.kind).toBe('screenshot');
    expect(harness.performAction.mock.calls[1]![0].action.kind).toBe('diagnostics');
    expect(harness.close).toHaveBeenCalledWith(rotated.lease, 'completed');
  });

  it.each([
    ['query navigation', { kind: 'navigate', url: 'http://localhost:4173/path?token=secret' }],
    ['hash navigation', { kind: 'navigate', url: 'http://localhost:4173/path#secret' }],
    [
      'password target',
      { kind: 'fill', target: { role: 'textbox', name: 'Password' }, value: 'hello' },
    ],
    [
      'secret fill value',
      { kind: 'fill', target: { role: 'textbox', name: 'Goal' }, value: 'token=secret' },
    ],
    [
      'cookie target',
      { kind: 'fill', target: { role: 'textbox', name: 'Cookie' }, value: 'hello' },
    ],
    [
      'set-cookie target',
      { kind: 'fill', target: { role: 'textbox', name: 'Set-Cookie' }, value: 'hello' },
    ],
    [
      'session-cookie target',
      { kind: 'fill', target: { role: 'textbox', name: 'Session Cookie' }, value: 'hello' },
    ],
    [
      'cookie fill value',
      {
        kind: 'fill',
        target: { role: 'textbox', name: 'Goal' },
        value: 'cookie=sessionid=raw-cookie-secret',
      },
    ],
  ])('rejects %s before the Electron service sees it', async (_label, action) => {
    const harness = makeHarness({ responses: [actionBlock(action)] });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    expect(harness.performAction).not.toHaveBeenCalled();
  });

  it('does not echo a rejected cookie fill into browser, prompt, result, or evidence', async () => {
    const rawCookie = 'raw-cookie-secret';
    const harness = makeHarness({
      responses: [
        actionBlock({
          kind: 'fill',
          target: { role: 'textbox', name: 'Goal' },
          value: `cookie=sessionid=${rawCookie}`,
        }),
      ],
    });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    expect(harness.performAction).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(harness.nestedDriver.sendPrompt).mock.calls)).not.toContain(
      rawCookie
    );
    expect(JSON.stringify(result)).not.toContain(rawCookie);
    expect(JSON.stringify(vi.mocked(harness.evidenceRun.finish).mock.calls)).not.toContain(
      rawCookie
    );
  });

  it('turns a pass into failure when sensitive partition cleanup is incomplete', async () => {
    const harness = makeHarness();
    harness.close.mockImplementation(async (lease, reason) => ({
      type: 'closed',
      ...lease,
      reason,
      partitionDataCleared: false,
      cleanupError: 'partition cleanup failed',
      closedAt: '2026-01-01T00:00:00.000Z',
    }));

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.kind).toBe('execution-error');
      expect(result.error.message).toContain('Native browser criteria passed');
      expect(result.error.message).toContain('partition cleanup failed');
    }
    expect(harness.evidenceRun.finish).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('surfaces partition cleanup recovery alongside an ordinary verification failure', async () => {
    const harness = makeHarness({
      responses: [
        actionBlock({ kind: 'accessibility-snapshot' }),
        `${NATIVE_BROWSER_FAILED_PREFIX} dialog did not open>>>`,
      ],
    });
    harness.close.mockImplementation(async (lease, reason) => ({
      type: 'closed',
      ...lease,
      reason,
      partitionDataCleared: false,
      cleanupError: 'partition cleanup failed',
      closedAt: '2026-01-01T00:00:00.000Z',
    }));

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.kind).toBe('execution-error');
      expect(result.error.message).not.toContain('dialog did not open');
      expect(result.error.message).toContain('partition cleanup failed');
    }
    expect(harness.evidenceRun.finish).toHaveBeenCalledWith({
      status: 'failed',
      summary: expect.stringContaining('dialog did not open'),
    });
    expect(harness.evidenceRun.finish).toHaveBeenCalledWith({
      status: 'failed',
      summary: expect.stringContaining('dialog did not open'),
    });
    expect(harness.evidenceRun.appendIntermediateFailure).toHaveBeenCalledWith({
      kind: 'browser-cleanup',
      message: 'partition cleanup failed',
    });
  });

  it('keeps multiple cleanup details ahead of a maximum-length primary failure', async () => {
    const harness = makeHarness();
    harness.nestedDriver.sendPrompt = vi.fn(async () =>
      err({ kind: 'prompt-failed' as const, message: `primary failure ${'x'.repeat(8_000)}` })
    );
    harness.close.mockImplementation(async (lease, reason) => ({
      type: 'closed',
      ...lease,
      reason,
      partitionDataCleared: false,
      cleanupError: 'long-primary partition cleanup failed',
      closedAt: '2026-01-01T00:00:00.000Z',
    }));
    harness.ctx.setActiveConversation = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('long-primary outer restore failed'));

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.kind).toBe('execution-error');
      expect(result.error.message).toMatch(/^Cleanup recovery required:/u);
      expect(result.error.message).toContain('long-primary partition cleanup failed');
      expect(result.error.message).toContain('long-primary outer restore failed');
      expect(result.error.message).toContain('Primary result: primary failure');
      expect(result.error.message.length).toBeLessThanOrEqual(4_096);
    }
  });

  it('preserves cancelled evidence status while surfacing partition cleanup recovery', async () => {
    const controller = new AbortController();
    const harness = makeHarness({ context: { signal: controller.signal } });
    const heldPrompt =
      deferred<Result<{ finalText: string }, { kind: 'prompt-failed'; message: string }>>();
    harness.nestedDriver.sendPrompt = vi.fn(() => heldPrompt.promise);
    harness.nestedDriver.cancelPrompt = vi.fn(async () => {
      heldPrompt.resolve(err({ kind: 'prompt-failed', message: 'cancelled' }));
      return ok(undefined);
    });
    harness.close.mockImplementation(async (lease, reason) => ({
      type: 'closed',
      ...lease,
      reason,
      partitionDataCleared: false,
      cleanupError: 'cancel cleanup failed',
      closedAt: '2026-01-01T00:00:00.000Z',
    }));

    const runPromise = harness.verifier.run(harness.ctx);
    await waitForCall(vi.mocked(harness.nestedDriver.sendPrompt));
    controller.abort();
    const result = await runPromise;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.kind).toBe('execution-error');
      expect(result.error.message).toContain('cancelled');
      expect(result.error.message).toContain('cancel cleanup failed');
    }
    expect(harness.evidenceRun.finish).toHaveBeenCalledWith({
      status: 'cancelled',
      summary: expect.stringContaining('cancel cleanup failed'),
    });
  });

  it('surfaces outer-conversation restore and evidence-finalize recovery on failed runs', async () => {
    const restoreHarness = makeHarness({
      responses: [
        actionBlock({ kind: 'accessibility-snapshot' }),
        `${NATIVE_BROWSER_FAILED_PREFIX} observed product failure>>>`,
      ],
    });
    restoreHarness.ctx.setActiveConversation = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('outer restore failed'));

    const restoreResult = await restoreHarness.verifier.run(restoreHarness.ctx);

    expect(restoreResult.success).toBe(false);
    if (!restoreResult.success) {
      expect(restoreResult.error.kind).toBe('execution-error');
      expect(restoreResult.error.message).not.toContain('observed product failure');
      expect(restoreResult.error.message).toContain('outer restore failed');
    }
    expect(restoreHarness.evidenceRun.appendIntermediateFailure).toHaveBeenCalledWith({
      kind: 'conversation-restore',
      message: 'outer restore failed',
    });

    const evidenceHarness = makeHarness({
      responses: [
        actionBlock({ kind: 'accessibility-snapshot' }),
        `${NATIVE_BROWSER_FAILED_PREFIX} observed product failure>>>`,
      ],
    });
    evidenceHarness.evidenceRun.finish = vi.fn(async () => {
      throw new Error('evidence disk unavailable');
    });
    evidenceHarness.evidenceRun.abandon = vi.fn(async () => {
      throw new Error('evidence release unavailable');
    });

    const evidenceResult = await evidenceHarness.verifier.run(evidenceHarness.ctx);

    expect(evidenceResult.success).toBe(false);
    if (!evidenceResult.success) {
      expect(evidenceResult.error.kind).toBe('execution-error');
      expect(evidenceResult.error.message).not.toContain('observed product failure');
      expect(evidenceResult.error.message).toContain('evidence disk unavailable');
      expect(evidenceResult.error.message).toContain('evidence release unavailable');
    }
    expect(evidenceHarness.evidenceRun.abandon).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      `${NATIVE_BROWSER_FAILED_PREFIX} dialog did not open>>>`,
      'failed',
      'Native browser criteria failed. See app-data evidence.',
      'dialog did not open',
    ],
    [
      `${NATIVE_BROWSER_CORRECTION_REQUIRED_PREFIX} fix dialog state>>>`,
      'correction-required',
      'Native browser correction is required. See app-data evidence.',
      'fix dialog state',
    ],
  ])('retains terminal failure evidence for %s', async (terminal, status, message, detail) => {
    const harness = makeHarness({
      responses: [actionBlock({ kind: 'accessibility-snapshot' }), terminal],
    });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toBe(message);
    expect(harness.evidenceRun.finish).toHaveBeenCalledWith({ status, summary: detail });
    expect(harness.evidenceRun.appendIntermediateFailure).toHaveBeenCalled();
  });

  it('fails immediately on closed/mismatched lease authority', async () => {
    const harness = makeHarness({ responses: [actionBlock({ kind: 'accessibility-snapshot' })] });
    harness.performAction.mockResolvedValue({
      result: {
        ok: false,
        error: { kind: 'identity-mismatch', message: 'lease belongs to another run' },
      },
    });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toBe('lease belongs to another run');
    expect(harness.reconcilePreview).not.toHaveBeenCalled();
  });

  it('rejects an oversized or structurally invalid service observation', async () => {
    const harness = makeHarness({ responses: [actionBlock({ kind: 'accessibility-snapshot' })] });
    harness.performAction.mockResolvedValue({
      result: {
        ok: true,
        observation: {
          kind: 'accessibility-snapshot',
          snapshot: 'x'.repeat(65_537),
          truncated: false,
        },
      },
    } as VerificationActionExecution);

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.kind).toBe('execution-error');
  });

  it.each([
    ['navigate', { kind: 'navigate', url: 'http://localhost:4173/dashboard' }],
    ['snapshot', { kind: 'accessibility-snapshot' }],
    ['query', { kind: 'accessibility-query', target: { role: 'button', name: 'Save' }, limit: 5 }],
    ['click', { kind: 'click', target: { role: 'button', name: 'Save' } }],
    ['fill', { kind: 'fill', target: { role: 'textbox', name: 'Goal' }, value: 'safe value' }],
    ['keypress', { kind: 'keypress', key: 'Tab' }],
    ['screenshot', { kind: 'screenshot' }],
    ['diagnostics', { kind: 'diagnostics', limit: 5 }],
  ])('rejects mismatched successful observation evidence for %s', async (label, action) => {
    const harness = makeHarness({ responses: [actionBlock(action)] });
    const wrongObservation =
      label === 'diagnostics'
        ? { kind: 'accessibility-snapshot' as const, snapshot: 'stale', truncated: false }
        : { kind: 'diagnostics' as const, entries: [], truncated: false };
    harness.performAction.mockResolvedValue({
      result: { ok: true, observation: wrongObservation },
    });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.kind).toBe('execution-error');
      expect(result.error.message).toMatch(/evidence for|expected/i);
    }
    expect(harness.evidenceRun.appendObservation).not.toHaveBeenCalled();
  });

  it('rejects an evidence path inside either repository before opening a browser', async () => {
    const harness = makeHarness({ evidenceDirectory: '/feature/worktree/.emdash/evidence' });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    expect(harness.start).not.toHaveBeenCalled();
    expect(harness.evidenceRun.finish).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it.each([
    ['feature repository', '/feature/worktree/..evidence/run'],
    ['verification repository', '/verification/clean-room/..evidence/run'],
  ])('rejects an evidence path in a valid ..-prefixed child of the %s', async (_label, path) => {
    const harness = makeHarness({ evidenceDirectory: path });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    expect(harness.start).not.toHaveBeenCalled();
  });

  it('allows a true sibling app-data evidence path outside local repositories', async () => {
    const harness = makeHarness({ evidenceDirectory: '/feature/outside/evidence/run' });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(true);
    expect(harness.start).toHaveBeenCalled();
  });

  it('does not compare local app-data evidence with remote repository path strings', async () => {
    const harness = makeHarness({
      target: SSH_TARGET,
      evidenceDirectory: '/feature/worktree/local-app-data/evidence/run',
    });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(true);
    expect(harness.start).toHaveBeenCalled();
  });

  it('reports native availability without probing Agent Browser, MCP, or a network bridge', async () => {
    const harness = makeHarness();

    const availability = await harness.verifier.checkAvailability('/feature/worktree');

    expect(availability).toEqual(ok({ available: true }));
    expect(harness.resolveTrustedBinding).not.toHaveBeenCalled();
    expect(harness.start).not.toHaveBeenCalled();
  });
});
