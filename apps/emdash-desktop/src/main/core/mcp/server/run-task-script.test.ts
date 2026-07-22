import { err, ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  ensureProjectOpen: vi.fn(),
  resolveLifecycleScript: vi.fn(),
  runLifecycleScriptWithPolicy: vi.fn(),
  stopLifecycleScriptSession: vi.fn(),
  isLifecycleScriptSessionActive: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: { select: mocks.select },
}));

vi.mock('@main/db/schema', () => ({
  tasks: {},
}));

vi.mock('@main/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: mocks.logError },
}));

vi.mock('./create-task-from-prompt', () => ({
  ensureProjectOpen: mocks.ensureProjectOpen,
}));

vi.mock('@main/core/terminals/lifecycle-script-settings', () => ({
  resolveLifecycleScript: mocks.resolveLifecycleScript,
}));

vi.mock('@main/core/terminals/lifecycle-script-coordinator', () => ({
  runLifecycleScriptWithPolicy: mocks.runLifecycleScriptWithPolicy,
  stopLifecycleScriptSession: mocks.stopLifecycleScriptSession,
  isLifecycleScriptSessionActive: mocks.isLifecycleScriptSessionActive,
}));

const { runTaskScript, stopTaskScript } = await import('./run-task-script');

/** One queued row-set per `db.select()` call; mirrors register-tools.test.ts. */
function queueTaskRow(row: { id: string; workspaceId: string | null } | undefined): void {
  mocks.select.mockImplementation(() => {
    const chain = {
      from: () => chain,
      where: () => chain,
      limit: () => chain,
      then: (onFulfilled: (rows: unknown) => unknown) =>
        Promise.resolve(row ? [row] : []).then(onFulfilled),
    };
    return chain;
  });
}

const workspace = { id: 'ws1' };

beforeEach(() => {
  vi.clearAllMocks();
  queueTaskRow({ id: 't1', workspaceId: 'ws1' });
  mocks.ensureProjectOpen.mockResolvedValue({});
  mocks.isLifecycleScriptSessionActive.mockReturnValue(false);
  mocks.resolveLifecycleScript.mockResolvedValue(
    ok({ workspace, script: 'npm run dev', shellSetup: undefined })
  );
});

describe('runTaskScript resolution', () => {
  it('reports a task that is not in the project', async () => {
    queueTaskRow(undefined);
    const result = await runTaskScript({ projectId: 'p1', taskId: 't1', type: 'setup' });
    expect(result).toEqual({
      status: 'not_found',
      message: 'Task not found in project p1: t1',
    });
    expect(mocks.runLifecycleScriptWithPolicy).not.toHaveBeenCalled();
  });

  it('reports a task whose worktree is not provisioned', async () => {
    queueTaskRow({ id: 't1', workspaceId: null });
    const result = await runTaskScript({ projectId: 'p1', taskId: 't1', type: 'setup' });
    expect(result.status).toBe('not_found');
    expect(mocks.runLifecycleScriptWithPolicy).not.toHaveBeenCalled();
  });

  it('opens the project before resolving the workspace script', async () => {
    mocks.runLifecycleScriptWithPolicy.mockResolvedValue({
      kind: 'succeeded',
      result: { kind: 'exited', exitCode: 0, outputTail: '' },
    });
    await runTaskScript({ projectId: 'p1', taskId: 't1', type: 'setup' });
    expect(mocks.ensureProjectOpen).toHaveBeenCalledWith('p1');
    const openOrder = mocks.ensureProjectOpen.mock.invocationCallOrder[0] ?? 0;
    const resolveOrder = mocks.resolveLifecycleScript.mock.invocationCallOrder[0] ?? 0;
    expect(openOrder).toBeLessThan(resolveOrder);
  });

  it('fails when the project cannot be opened', async () => {
    mocks.ensureProjectOpen.mockResolvedValue(undefined);
    const result = await runTaskScript({ projectId: 'p1', taskId: 't1', type: 'setup' });
    expect(result).toEqual({
      status: 'not_found',
      message: 'Project p1 could not be opened',
    });
    expect(mocks.runLifecycleScriptWithPolicy).not.toHaveBeenCalled();
  });

  it('reports no_script when the type has no configured script', async () => {
    mocks.resolveLifecycleScript.mockResolvedValue(ok({ workspace, script: undefined }));
    const result = await runTaskScript({ projectId: 'p1', taskId: 't1', type: 'teardown' });
    expect(result).toEqual({ status: 'no_script', type: 'teardown' });
    expect(mocks.runLifecycleScriptWithPolicy).not.toHaveBeenCalled();
  });

  it('surfaces a lifecycle settings error', async () => {
    mocks.resolveLifecycleScript.mockResolvedValue(
      err({ type: 'not_found', entity: 'workspace', workspaceId: 'ws1' })
    );
    const result = await runTaskScript({ projectId: 'p1', taskId: 't1', type: 'setup' });
    expect(result.status).toBe('not_found');
    expect(mocks.runLifecycleScriptWithPolicy).not.toHaveBeenCalled();
  });
});

describe('runTaskScript execution', () => {
  // A never-resolving promise stands in for a script still running when the tool
  // returns; runTaskScript must resolve to 'started' without awaiting it.
  const pending = () => new Promise(() => {});

  it.each(['setup', 'run', 'teardown'] as const)(
    'starts a %s script without waiting for it to finish',
    async (type) => {
      mocks.runLifecycleScriptWithPolicy.mockReturnValue(pending());
      const result = await runTaskScript({ projectId: 'p1', taskId: 't1', type });
      expect(result).toEqual({ status: 'started', type });
      const policy = mocks.runLifecycleScriptWithPolicy.mock.calls[0][0].policy;
      // Fire-and-forget: never block the caller, never throw into the void.
      expect(policy.waitForExit).toBeUndefined();
      expect(policy.timeoutMs).toBeUndefined();
      expect(policy.continueOnFailure).toBe(true);
    }
  );

  it.each(['setup', 'run', 'teardown'] as const)(
    'reports already_running when a %s script is already active',
    async (type) => {
      mocks.isLifecycleScriptSessionActive.mockReturnValue(true);
      const result = await runTaskScript({ projectId: 'p1', taskId: 't1', type });
      expect(result).toEqual({ status: 'already_running', type });
      expect(mocks.runLifecycleScriptWithPolicy).not.toHaveBeenCalled();
    }
  );

  it('does not leak an unhandled rejection when a backgrounded script fails', async () => {
    mocks.runLifecycleScriptWithPolicy.mockRejectedValue(new Error('spawn failed'));
    const result = await runTaskScript({ projectId: 'p1', taskId: 't1', type: 'setup' });
    expect(result).toEqual({ status: 'started', type: 'setup' });
    // Let the rejected background promise settle so the .catch handler runs.
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.logError).toHaveBeenCalledWith(
      'McpHttpServer: setup script failed',
      expect.objectContaining({ error: expect.stringContaining('spawn failed') })
    );
  });
});

describe('stopTaskScript', () => {
  it('reports stopped when a session was killed', async () => {
    mocks.stopLifecycleScriptSession.mockReturnValue(true);
    const result = await stopTaskScript({ projectId: 'p1', taskId: 't1', type: 'run' });
    expect(result).toEqual({ status: 'stopped', type: 'run' });
    expect(mocks.stopLifecycleScriptSession).toHaveBeenCalledWith({
      projectId: 'p1',
      taskId: 't1',
      workspaceId: 'ws1',
      type: 'run',
      origin: 'manual',
    });
  });

  it('reports not_running when nothing was stopped', async () => {
    mocks.stopLifecycleScriptSession.mockReturnValue(false);
    const result = await stopTaskScript({ projectId: 'p1', taskId: 't1', type: 'run' });
    expect(result).toEqual({ status: 'not_running', type: 'run' });
  });

  it('can stop a non-run script such as setup', async () => {
    mocks.stopLifecycleScriptSession.mockReturnValue(true);
    const result = await stopTaskScript({ projectId: 'p1', taskId: 't1', type: 'setup' });
    expect(result).toEqual({ status: 'stopped', type: 'setup' });
    expect(mocks.stopLifecycleScriptSession).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'setup' })
    );
  });

  it('reports a task that is not in the project without touching the session', async () => {
    queueTaskRow(undefined);
    const result = await stopTaskScript({ projectId: 'p1', taskId: 't1', type: 'run' });
    expect(result.status).toBe('not_found');
    expect(mocks.stopLifecycleScriptSession).not.toHaveBeenCalled();
  });

  it('does not open the project as a side effect of stopping', async () => {
    // Stopping works off the PTY registry by session id; opening the project
    // would mount workspaces and run hooks just to stop a script.
    mocks.stopLifecycleScriptSession.mockReturnValue(true);
    const result = await stopTaskScript({ projectId: 'p1', taskId: 't1', type: 'run' });
    expect(result).toEqual({ status: 'stopped', type: 'run' });
    expect(mocks.ensureProjectOpen).not.toHaveBeenCalled();
  });
});
