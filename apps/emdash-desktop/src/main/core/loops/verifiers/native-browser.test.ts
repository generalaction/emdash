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
              'javascript:alert(secret)',
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
                message: 'authorization=BearerSecret file:///etc/passwd',
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
    expect(prompts).not.toContain('file:///');
    expect(prompts).not.toContain('data:text');
    expect(prompts).not.toContain('javascript:');
    expect(prompts).not.toContain('?token=');
    expect(prompts).not.toContain('#private');
    expect(harness.evidenceRun.appendObservation).toHaveBeenCalledTimes(3);
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
  ])('rejects %s before the Electron service sees it', async (_label, action) => {
    const harness = makeHarness({ responses: [actionBlock(action)] });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    expect(harness.performAction).not.toHaveBeenCalled();
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
      expect(result.error.message).toBe('partition cleanup failed');
    }
    expect(harness.evidenceRun.finish).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it.each([
    [`${NATIVE_BROWSER_FAILED_PREFIX} dialog did not open>>>`, 'failed', 'dialog did not open'],
    [
      `${NATIVE_BROWSER_CORRECTION_REQUIRED_PREFIX} fix dialog state>>>`,
      'correction-required',
      'Native browser correction required: fix dialog state',
    ],
  ])('retains terminal failure evidence for %s', async (terminal, status, message) => {
    const harness = makeHarness({
      responses: [actionBlock({ kind: 'accessibility-snapshot' }), terminal],
    });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toBe(message);
    expect(harness.evidenceRun.finish).toHaveBeenCalledWith(expect.objectContaining({ status }));
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

  it('rejects an evidence path inside either repository before opening a browser', async () => {
    const harness = makeHarness({ evidenceDirectory: '/feature/worktree/.emdash/evidence' });

    const result = await harness.verifier.run(harness.ctx);

    expect(result.success).toBe(false);
    expect(harness.start).not.toHaveBeenCalled();
    expect(harness.evidenceRun.finish).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('reports native availability without probing Agent Browser, MCP, or a network bridge', async () => {
    const harness = makeHarness();

    const availability = await harness.verifier.checkAvailability('/feature/worktree');

    expect(availability).toEqual(ok({ available: true }));
    expect(harness.resolveTrustedBinding).not.toHaveBeenCalled();
    expect(harness.start).not.toHaveBeenCalled();
  });
});
