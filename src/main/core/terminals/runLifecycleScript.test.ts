import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getEffectiveTaskSettings } from '../projects/settings/task-settings';
import { resolveWorkspace } from '../projects/utils';
import { runLifecycleScript } from './runLifecycleScript';

vi.mock('../projects/settings/task-settings', () => ({
  getEffectiveTaskSettings: vi.fn(),
}));

vi.mock('../projects/utils', () => ({
  resolveWorkspace: vi.fn(),
}));

describe('runLifecycleScript', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('runs manual lifecycle scripts with exit so command completion closes the PTY', async () => {
    const lifecycleRun = vi.fn(async () => {});
    vi.mocked(resolveWorkspace).mockReturnValue({
      settings: {},
      fs: {},
      lifecycleService: {
        runLifecycleScript: lifecycleRun,
      },
    } as never);
    vi.mocked(getEffectiveTaskSettings).mockResolvedValue({
      scripts: {
        run: 'pnpm dev',
      },
    } as never);

    await runLifecycleScript({
      projectId: 'project-1',
      workspaceId: 'branch:feature',
      type: 'run',
    });

    expect(lifecycleRun).toHaveBeenCalledWith({ type: 'run', script: 'pnpm dev' }, { exit: true });
  });
});
