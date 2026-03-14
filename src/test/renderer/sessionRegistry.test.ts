import { beforeEach, describe, expect, it, vi } from 'vitest';

const managerInstances: Array<{
  attach: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  setTheme: ReturnType<typeof vi.fn>;
  restart: ReturnType<typeof vi.fn>;
  isPtyActive: ReturnType<typeof vi.fn>;
}> = [];

vi.mock('../../renderer/terminal/TerminalSessionManager', () => ({
  TerminalSessionManager: vi.fn().mockImplementation(() => {
    const instance = {
      attach: vi.fn(),
      detach: vi.fn(),
      dispose: vi.fn(),
      setTheme: vi.fn(),
      restart: vi.fn().mockResolvedValue(true),
      isPtyActive: vi.fn().mockReturnValue(true),
    };
    managerInstances.push(instance);
    return instance;
  }),
}));

import { terminalSessionRegistry } from '../../renderer/terminal/SessionRegistry';

describe('terminalSessionRegistry', () => {
  beforeEach(() => {
    terminalSessionRegistry.disposeAll();
    managerInstances.length = 0;
    vi.clearAllMocks();
  });

  it('restarts an existing remote session when its PTY is no longer active', () => {
    const theme = { base: 'dark' as const };
    const container = {} as HTMLElement;

    const first = terminalSessionRegistry.attach({
      taskId: 'task-1',
      container,
      remote: { connectionId: 'ssh-1' },
      initialSize: { cols: 120, rows: 32 },
      theme,
    });

    expect(managerInstances).toHaveLength(1);
    expect(first).toBe(managerInstances[0]);

    managerInstances[0].isPtyActive.mockReturnValue(false);

    const second = terminalSessionRegistry.attach({
      taskId: 'task-1',
      container,
      remote: { connectionId: 'ssh-1' },
      initialSize: { cols: 120, rows: 32 },
      theme,
    });

    expect(second).toBe(first);
    expect(managerInstances[0].restart).toHaveBeenCalledTimes(1);
  });

  it('does not restart an active session on reattach', () => {
    const theme = { base: 'dark' as const };
    const container = {} as HTMLElement;

    terminalSessionRegistry.attach({
      taskId: 'task-2',
      container,
      remote: { connectionId: 'ssh-2' },
      initialSize: { cols: 120, rows: 32 },
      theme,
    });

    terminalSessionRegistry.attach({
      taskId: 'task-2',
      container,
      remote: { connectionId: 'ssh-2' },
      initialSize: { cols: 120, rows: 32 },
      theme,
    });

    expect(managerInstances[0].restart).not.toHaveBeenCalled();
  });
});
