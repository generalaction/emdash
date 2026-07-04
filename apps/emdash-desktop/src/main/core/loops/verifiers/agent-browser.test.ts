import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@main/lib/result';
import type { Loop, LoopPhase } from '@shared/core/loops/loops';
import type { LoopSessionDriver } from '../drivers/session-driver';
import { agentBrowserVerifier } from './agent-browser';
import type { VerifierRunContext } from './types';

function makeLoop(): Loop {
  return {
    id: 'loop-1',
    projectId: 'project-1',
    taskId: 'task-1',
    name: 'Loop',
    slug: 'loop',
    status: 'running',
    currentPhaseIndex: 0,
    config: {
      version: '1',
      verifiers: ['agent-browser'],
      reviewEnabled: false,
      validationCommands: ['pnpm run test'],
      planSource: 'manual',
      agentBrowser: { targetUrl: 'http://localhost:5173', cdpPort: 9222 },
    },
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
    goal: 'Verify the UI',
    status: 'verifying',
    attempts: 1,
    conversationId: 'phase-conv',
    criteria: {
      version: '1',
      criteria: [
        {
          description: 'The dashboard loads',
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

function makeDriver(finalText: string): LoopSessionDriver {
  return {
    kind: 'acp',
    startPhaseSession: vi.fn(async () => ok({ conversationId: 'phase-conv', title: 'loop-1' })),
    startVerificationSession: vi.fn(async () =>
      ok({ conversationId: 'verify-conv', title: 'loop-1-verify' })
    ),
    sendPrompt: vi.fn(async () => ok({ finalText })),
    cancelPrompt: vi.fn(async () => ok(undefined)),
  };
}

async function makeContext(
  patch: Partial<VerifierRunContext> = {}
): Promise<{ ctx: VerifierRunContext; tempDir: string; driver: LoopSessionDriver }> {
  const tempDir = await mkdtemp(join(tmpdir(), 'emdash-agent-browser-'));
  const loop = makeLoop();
  const phase = makePhase();
  const driver = makeDriver(`Observed the dashboard.\n<<<LOOP:VERIFY_PASSED>>>`);
  return {
    tempDir,
    driver,
    ctx: {
      loop,
      phase,
      cwd: tempDir,
      validationCommands: [],
      criteria: phase.criteria?.criteria ?? [],
      sessionDriver: driver,
      promptTimeoutMs: 10_000,
      setActiveConversation: vi.fn(),
      ...patch,
    },
  };
}

describe('agentBrowserVerifier', () => {
  let tempDirs: string[] = [];

  beforeEach(() => {
    tempDirs = [];
  });

  afterEach(async () => {
    vi.useRealTimers();
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  it('passes when the verification session returns the passed sentinel', async () => {
    const { ctx, tempDir, driver } = await makeContext();
    tempDirs.push(tempDir);

    const result = await agentBrowserVerifier.run(ctx);

    expect(result.success).toBe(true);
    expect(driver.startVerificationSession).toHaveBeenCalledWith({
      loop: ctx.loop,
      phase: ctx.phase,
    });
    expect(driver.sendPrompt).toHaveBeenCalledWith(
      'verify-conv',
      expect.stringContaining('You are an Emdash Loop VERIFICATION agent.')
    );
    expect(ctx.setActiveConversation).toHaveBeenNthCalledWith(1, 'verify-conv', driver);
    expect(ctx.setActiveConversation).toHaveBeenLastCalledWith('phase-conv', driver);
    if (result.success) {
      expect(result.data.command).toBe('ACP verification: loop-1-verify');
      expect(result.data.summary).toContain('Observed the dashboard.');
      expect(result.data.summary).toContain('.emdash-loops-evidence/loop-1/phase-1');
      expect(result.data.evidencePath).toBe(
        join(tempDir, '.emdash-loops-evidence', 'loop-1', 'phase-1')
      );
    }
  });

  it('fails with observed reasons from the failed sentinel', async () => {
    const driver = makeDriver('No dialog appeared.\n<<<LOOP:VERIFY_FAILED 1: no dialog>>>');
    const { ctx, tempDir } = await makeContext({ sessionDriver: driver });
    tempDirs.push(tempDir);

    const result = await agentBrowserVerifier.run(ctx);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.kind).toBe('command-failed');
      expect(result.error.message).toBe('1: no dialog');
      expect(result.error.command).toBe('ACP verification: loop-1-verify');
      expect(result.error.evidencePath).toContain('.emdash-loops-evidence/loop-1/phase-1');
    }
  });

  it('fails when the verification response omits a sentinel', async () => {
    const driver = makeDriver('I think it looks fine.');
    const { ctx, tempDir } = await makeContext({ sessionDriver: driver });
    tempDirs.push(tempDir);

    const result = await agentBrowserVerifier.run(ctx);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.kind).toBe('command-failed');
      expect(result.error.message).toContain('did not include');
    }
  });

  it('cancels and fails when the verification prompt times out', async () => {
    const { ctx, tempDir, driver } = await makeContext({ promptTimeoutMs: 1 });
    tempDirs.push(tempDir);
    driver.sendPrompt = vi.fn(
      (): ReturnType<LoopSessionDriver['sendPrompt']> => new Promise(() => {})
    );
    driver.cancelPrompt = vi.fn(async () => ok(undefined));

    const result = await agentBrowserVerifier.run(ctx);

    expect(result.success).toBe(false);
    expect(driver.cancelPrompt).toHaveBeenCalledWith('verify-conv');
    if (!result.success) {
      expect(result.error.kind).toBe('timed-out');
      expect(result.error.message).toBe('Agent Browser verification prompt timed out after 1s.');
    }
  });

  it('reports verification session start failures', async () => {
    const { ctx, tempDir, driver } = await makeContext();
    tempDirs.push(tempDir);
    driver.startVerificationSession = vi.fn(async () =>
      err({ kind: 'create-failed' as const, message: 'no ACP runtime' })
    );

    const result = await agentBrowserVerifier.run(ctx);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.kind).toBe('command-failed');
      expect(result.error.message).toBe('no ACP runtime');
    }
  });
});
