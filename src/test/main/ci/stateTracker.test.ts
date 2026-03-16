import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let userDataDir = '';

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir,
  },
}));

vi.mock('../../../main/lib/logger', () => ({
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('CiRetryStateTracker', () => {
  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-ci-state-'));
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it('increments retry count and halts when maxRetries is reached', async () => {
    const { CiRetryStateTracker } = await import('../../../main/services/ci/stateTracker');
    const tracker = new CiRetryStateTracker();

    const branchKey = CiRetryStateTracker.buildBranchKey('project-a', 'emdash/task-123');

    const gate1 = tracker.evaluateTrigger({
      branchKey,
      projectId: 'project-a',
      branchName: 'emdash/task-123',
      currentHeadSha: 'sha-1',
      runId: 1001,
      maxRetries: 2,
    });
    expect(gate1.allowed).toBe(true);

    const stateAfterFirst = tracker.markTriggered({
      branchKey,
      projectId: 'project-a',
      branchName: 'emdash/task-123',
      currentHeadSha: 'sha-1',
      runId: 1001,
      maxRetries: 2,
    });
    expect(stateAfterFirst.retryCount).toBe(1);
    expect(stateAfterFirst.halted).toBe(false);

    const stateAfterSecond = tracker.markTriggered({
      branchKey,
      projectId: 'project-a',
      branchName: 'emdash/task-123',
      currentHeadSha: 'sha-1',
      runId: 1002,
      maxRetries: 2,
    });
    expect(stateAfterSecond.retryCount).toBe(2);
    expect(stateAfterSecond.halted).toBe(true);

    const gateBlocked = tracker.evaluateTrigger({
      branchKey,
      projectId: 'project-a',
      branchName: 'emdash/task-123',
      currentHeadSha: 'sha-1',
      runId: 1003,
      maxRetries: 2,
    });
    expect(gateBlocked.allowed).toBe(false);
    expect(gateBlocked.reason).toBe('max-retries-reached');
  });

  it('resets retry state when a manual head change is detected', async () => {
    const { CiRetryStateTracker } = await import('../../../main/services/ci/stateTracker');
    const tracker = new CiRetryStateTracker();

    const branchKey = CiRetryStateTracker.buildBranchKey('project-b', 'emdash/task-manual');

    tracker.markTriggered({
      branchKey,
      projectId: 'project-b',
      branchName: 'emdash/task-manual',
      currentHeadSha: 'agent-sha-1',
      runId: 2001,
      maxRetries: 1,
    });
    tracker.markAgentCommit(branchKey, 'project-b', 'emdash/task-manual', 'agent-sha-1');

    const gateAfterManualCommit = tracker.evaluateTrigger({
      branchKey,
      projectId: 'project-b',
      branchName: 'emdash/task-manual',
      currentHeadSha: 'human-sha-2',
      runId: 2002,
      maxRetries: 1,
    });

    expect(gateAfterManualCommit.allowed).toBe(true);
    expect(gateAfterManualCommit.state.retryCount).toBe(0);
    expect(gateAfterManualCommit.state.halted).toBe(false);
    expect(gateAfterManualCommit.state.lastObservedHeadSha).toBe('human-sha-2');
  });
});
