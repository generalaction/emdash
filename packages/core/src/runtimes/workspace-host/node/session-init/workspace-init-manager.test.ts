import { describe, expect, it, vi } from 'vitest';
import type {
  WorkspaceScriptRunInput,
  WorkspaceScriptRunOutcome,
  WorkspaceScriptRunner,
} from './script-runner';
import { WorkspaceInitManager } from './workspace-init-manager';

const succeeded = {
  status: 'succeeded',
  outputTail: '',
} as const satisfies WorkspaceScriptRunOutcome;

function runner(
  run: (input: WorkspaceScriptRunInput) => Promise<WorkspaceScriptRunOutcome>
): WorkspaceScriptRunner {
  return { run };
}

describe('WorkspaceInitManager', () => {
  it('activates after a non-fatal prepare failure and records a notice', async () => {
    const run = vi.fn(async (input: WorkspaceScriptRunInput) =>
      input.id === 'prepare'
        ? ({
            status: 'failed',
            message: 'prepare failed',
            exitCode: 1,
            outputTail: 'boom',
          } as const)
        : succeeded
    );
    const manager = new WorkspaceInitManager({
      runner: runner(run),
      readConfig: async () => JSON.stringify({ scripts: { prepare: 'prepare', setup: 'setup' } }),
      now: () => 42,
    });

    await expect(manager.initialize('/workspace')).resolves.toEqual({
      active: true,
      prepare: {
        status: 'failed',
        message: 'prepare failed',
        exitCode: 1,
        outputTail: 'boom',
      },
      notices: [
        {
          path: '/workspace',
          script: 'prepare',
          status: 'failed',
          message: 'prepare failed',
          exitCode: 1,
          outputTail: 'boom',
          at: 42,
        },
      ],
    });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ id: 'setup', cwd: '/workspace' }));
  });

  it('does not wait for setup before activation', async () => {
    let resolveSetup: ((value: WorkspaceScriptRunOutcome) => void) | undefined;
    const setup = new Promise<WorkspaceScriptRunOutcome>((resolve) => {
      resolveSetup = resolve;
    });
    const run = vi.fn(async (input: WorkspaceScriptRunInput) =>
      input.id === 'setup' ? await setup : succeeded
    );
    const manager = new WorkspaceInitManager({
      runner: runner(run),
      readConfig: async () => JSON.stringify({ scripts: { setup: 'setup' } }),
    });

    await expect(manager.initialize('/workspace')).resolves.toEqual({
      active: true,
      prepare: { status: 'skipped', outputTail: '' },
      notices: [],
    });
    expect(resolveSetup).toBeDefined();
    resolveSetup!(succeeded);
    await setup;
  });

  it('deduplicates successful initialization and reruns on config changes', async () => {
    let content = JSON.stringify({ scripts: { prepare: 'prepare one' } });
    const run = vi.fn(async () => succeeded);
    const manager = new WorkspaceInitManager({
      runner: runner(run),
      readConfig: async () => content,
    });

    await manager.initialize('/workspace');
    await manager.initialize('/workspace');
    expect(run).toHaveBeenCalledTimes(1);

    content = JSON.stringify({ scripts: { prepare: 'prepare two' } });
    await manager.initialize('/workspace');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('retries failed prepare and clears the active notice after success', async () => {
    const run = vi
      .fn<(input: WorkspaceScriptRunInput) => Promise<WorkspaceScriptRunOutcome>>()
      .mockResolvedValueOnce({
        status: 'failed',
        message: 'prepare failed',
        outputTail: 'boom',
      })
      .mockResolvedValueOnce(succeeded);
    const noticesChanged = vi.fn();
    const manager = new WorkspaceInitManager({
      runner: runner(run),
      readConfig: async () => JSON.stringify({ scripts: { prepare: 'prepare' } }),
      onNoticesChanged: noticesChanged,
    });

    await manager.initialize('/workspace');
    await manager.initialize('/workspace');
    expect(run).toHaveBeenCalledTimes(2);
    expect(noticesChanged).toHaveBeenLastCalledWith({});
  });

  it('uses a successful manual prepare rerun to satisfy the activation gate', async () => {
    const run = vi
      .fn<(input: WorkspaceScriptRunInput) => Promise<WorkspaceScriptRunOutcome>>()
      .mockResolvedValueOnce({
        status: 'failed',
        message: 'prepare failed',
        outputTail: 'boom',
      })
      .mockResolvedValueOnce(succeeded);
    const manager = new WorkspaceInitManager({
      runner: runner(run),
      readConfig: async () => JSON.stringify({ scripts: { prepare: 'prepare' } }),
    });

    await manager.initialize('/workspace');
    await manager.runConfiguredScript('/workspace', 'prepare');
    await manager.initialize('/workspace');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('keeps one active notice per workspace script', async () => {
    const run = vi.fn(async () => ({
      status: 'failed' as const,
      message: 'still failing',
      outputTail: 'boom',
    }));
    let now = 1;
    const manager = new WorkspaceInitManager({
      runner: runner(run),
      readConfig: async () => JSON.stringify({ scripts: { teardown: 'teardown' } }),
      now: () => now++,
    });

    await manager.initialize('/workspace');
    await manager.runConfiguredScript('/workspace', 'teardown');
    await manager.runConfiguredScript('/workspace', 'teardown');
    expect(manager.getNotices()['/workspace']).toHaveLength(1);
    expect(manager.getNotices()['/workspace']?.[0]?.at).toBe(2);
  });

  it('cancels and fences the old generation when configuration changes', async () => {
    let content = JSON.stringify({ scripts: { prepare: 'prepare one' } });
    let firstSignal: AbortSignal | undefined;
    let releaseFirst: (() => void) | undefined;
    const firstRun = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const run = vi.fn(async (input: WorkspaceScriptRunInput) => {
      if (input.command === 'prepare one') {
        firstSignal = input.signal;
        await firstRun;
        return {
          status: 'cancelled' as const,
          message: 'cancelled',
          outputTail: '',
        };
      }
      return succeeded;
    });
    const manager = new WorkspaceInitManager({
      runner: runner(run),
      readConfig: async () => content,
    });

    const first = manager.initialize('/workspace');
    await vi.waitFor(() => expect(firstSignal).toBeDefined());
    content = JSON.stringify({ scripts: { prepare: 'prepare two' } });
    const second = manager.initialize('/workspace');
    await vi.waitFor(() => expect(firstSignal?.aborted).toBe(true));
    releaseFirst!();

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).resolves.toMatchObject({
      active: true,
      prepare: { status: 'succeeded' },
    });
  });

  it('waits for background setup to stop before shutdown resolves', async () => {
    let setupSignal: AbortSignal | undefined;
    let releaseSetup: (() => void) | undefined;
    const setupRun = new Promise<void>((resolve) => {
      releaseSetup = resolve;
    });
    const manager = new WorkspaceInitManager({
      runner: runner(async (input) => {
        if (input.id === 'setup') {
          setupSignal = input.signal;
          await setupRun;
          return {
            status: 'cancelled',
            message: 'cancelled',
            outputTail: '',
          };
        }
        return succeeded;
      }),
      readConfig: async () => JSON.stringify({ scripts: { setup: 'setup' } }),
    });

    await manager.initialize('/workspace');
    const shutdown = manager.shutdown('/workspace');
    await vi.waitFor(() => expect(setupSignal?.aborted).toBe(true));
    let stopped = false;
    void shutdown.then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    releaseSetup!();
    await shutdown;
    expect(manager.isActive('/workspace')).toBe(false);
  });
});
