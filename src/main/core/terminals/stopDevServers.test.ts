import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hostPreviewEventChannel } from '@shared/events/hostPreviewEvents';
import { createLifecycleScriptTerminalId } from '@shared/terminals';
import { clearTerminalDevServer } from './dev-server-watcher';
import { stopLifecycleScriptSession } from './lifecycle-script-coordinator';
import { stopDevServers } from './stopDevServers';

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  logWarn: vi.fn(),
  ptyGet: vi.fn(),
  ptyUnregister: vi.fn(),
}));

vi.mock('@main/core/pty/pty-session-registry', () => ({
  ptySessionRegistry: {
    get: mocks.ptyGet,
    unregister: mocks.ptyUnregister,
  },
}));

vi.mock('@main/lib/events', () => ({
  events: {
    emit: mocks.emit,
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    warn: mocks.logWarn,
  },
}));

vi.mock('./dev-server-watcher', () => ({
  clearTerminalDevServer: vi.fn(),
}));

vi.mock('./lifecycle-script-coordinator', () => ({
  stopLifecycleScriptSession: vi.fn(),
}));

describe('stopDevServers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clearTerminalDevServer).mockReturnValue(false);
    vi.mocked(stopLifecycleScriptSession).mockReturnValue(false);
  });

  it('interrupts task-scoped terminal servers without killing the terminal PTY', async () => {
    const write = vi.fn();
    const kill = vi.fn();
    mocks.ptyGet.mockReturnValue({ write, kill });

    await stopDevServers({
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      servers: [
        { scopeId: 'task-1', terminalId: 'terminal-1' },
        { scopeId: 'task-1', terminalId: 'terminal-2' },
      ],
    });

    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledWith('\x03');
    expect(kill).not.toHaveBeenCalled();
    expect(mocks.ptyUnregister).not.toHaveBeenCalled();
    expect(mocks.emit).toHaveBeenCalledWith(hostPreviewEventChannel, {
      type: 'exit',
      projectId: 'project-1',
      taskId: 'task-1',
      terminalId: 'terminal-1',
    });
    expect(mocks.emit).toHaveBeenCalledWith(hostPreviewEventChannel, {
      type: 'exit',
      projectId: 'project-1',
      taskId: 'task-1',
      terminalId: 'terminal-2',
    });
  });

  it('uses watcher cleanup to reset future URL detection for interrupted terminals', async () => {
    const write = vi.fn();
    mocks.ptyGet.mockReturnValue({ write });
    vi.mocked(clearTerminalDevServer).mockReturnValue(true);

    await stopDevServers({
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      servers: [{ scopeId: 'task-1', terminalId: 'terminal-1' }],
    });

    expect(write).toHaveBeenCalledWith('\x03');
    expect(clearTerminalDevServer).toHaveBeenCalledWith('task-1', 'terminal-1');
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('stops the workspace run script through the lifecycle coordinator', async () => {
    vi.mocked(stopLifecycleScriptSession).mockReturnValue(true);

    await stopDevServers({
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      servers: [{ scopeId: 'workspace-1', terminalId: createLifecycleScriptTerminalId('run') }],
    });

    expect(stopLifecycleScriptSession).toHaveBeenCalledWith({
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      type: 'run',
      origin: 'manual',
    });
    expect(mocks.ptyGet).not.toHaveBeenCalled();
    expect(mocks.emit).toHaveBeenCalledWith(hostPreviewEventChannel, {
      type: 'exit',
      projectId: 'project-1',
      taskId: 'workspace-1',
      terminalId: createLifecycleScriptTerminalId('run'),
    });
  });

  it('falls back to killing the registered PTY when a workspace server is not coordinator-owned', async () => {
    const kill = vi.fn();
    mocks.ptyGet.mockReturnValue({ kill });

    await stopDevServers({
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      servers: [{ scopeId: 'workspace-1', terminalId: createLifecycleScriptTerminalId('run') }],
    });

    expect(kill).toHaveBeenCalledTimes(1);
    expect(mocks.ptyUnregister).toHaveBeenCalledWith(
      `project-1:workspace-1:${createLifecycleScriptTerminalId('run')}`
    );
    expect(mocks.emit).toHaveBeenCalledWith(hostPreviewEventChannel, {
      type: 'exit',
      projectId: 'project-1',
      taskId: 'workspace-1',
      terminalId: createLifecycleScriptTerminalId('run'),
    });
  });

  it('kills a run-script server from another project instead of using the current task coordinator', async () => {
    const kill = vi.fn();
    mocks.ptyGet.mockReturnValue({ kill });

    await stopDevServers({
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      servers: [
        {
          projectId: 'project-2',
          scopeId: 'workspace-2',
          terminalId: createLifecycleScriptTerminalId('run'),
        },
      ],
    });

    expect(stopLifecycleScriptSession).not.toHaveBeenCalled();
    expect(kill).toHaveBeenCalledTimes(1);
    expect(mocks.ptyUnregister).toHaveBeenCalledWith(
      `project-2:workspace-2:${createLifecycleScriptTerminalId('run')}`
    );
    expect(mocks.emit).toHaveBeenCalledWith(hostPreviewEventChannel, {
      type: 'exit',
      projectId: 'project-2',
      taskId: 'workspace-2',
      terminalId: createLifecycleScriptTerminalId('run'),
    });
  });
});
