import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getEffectiveTaskSettings } from '../projects/settings/effective-task-settings';
import { resolveWorkspace } from '../projects/utils';
import { runLifecycleScript } from './runLifecycleScript';

const runCoordinator = vi.hoisted(() =>
  vi.fn(async ({ workspace, type, script, shellSetup, policy }) => {
    await workspace.lifecycleService.runLifecycleScript(
      { type, script, shellSetup },
      {
        exit: policy.exit ?? true,
        waitForExit: policy.waitForExit ?? true,
        respawnAfterExit: policy.respawnAfterExit ?? false,
      }
    );
  })
);

vi.mock('../projects/settings/effective-task-settings', () => ({
  getEffectiveTaskSettings: vi.fn(),
}));

vi.mock('../projects/utils', () => ({
  resolveWorkspace: vi.fn(),
}));

vi.mock('./lifecycle-script-coordinator', () => ({
  runLifecycleScriptWithPolicy: runCoordinator,
}));

describe('runLifecycleScript', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('runs manual lifecycle scripts with exit and restores the prompt afterward', async () => {
    const lifecycleRun = vi.fn(async () => {});
    vi.mocked(resolveWorkspace).mockReturnValue({
      settings: {},
      fs: {},
      lifecycleService: {
        runLifecycleScript: lifecycleRun,
      },
    } as never);
    vi.mocked(getEffectiveTaskSettings).mockResolvedValue({
      shellSetup: 'source .envrc',
      scripts: {
        run: 'pnpm dev',
      },
    } as never);

    await runLifecycleScript({
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'branch:feature',
      type: 'run',
    });

    expect(lifecycleRun).toHaveBeenCalledWith(
      { type: 'run', script: 'pnpm dev', shellSetup: 'source .envrc' },
      { exit: true, waitForExit: true, respawnAfterExit: true }
    );
    expect(runCoordinator).toHaveBeenCalledWith({
      workspace: expect.any(Object),
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'branch:feature',
      type: 'run',
      script: 'pnpm dev',
      shellSetup: 'source .envrc',
      origin: 'manual',
      policy: {
        respawnAfterExit: true,
        logFailure: true,
        surfaceFailure: true,
        continueOnFailure: false,
      },
      logPrefix: 'TerminalsController',
    });
  });
});
