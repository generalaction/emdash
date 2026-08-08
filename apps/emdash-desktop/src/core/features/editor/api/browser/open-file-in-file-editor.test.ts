import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import { openFileInAdjacentPane, openFileInTaskEditor } from './open-file-in-file-editor';

const mocks = vi.hoisted(() => ({
  getTaskComposition: vi.fn(),
  getTaskStore: vi.fn(),
  getWorkspace: vi.fn(),
  openFile: vi.fn(),
  openPath: vi.fn(),
  transition: vi.fn(),
}));

vi.mock('@core/features/tasks/api/browser/task-state/task-selectors', () => ({
  asProvisioned: (task: unknown) => task,
  getTaskStore: mocks.getTaskStore,
}));

vi.mock('@core/features/workbench/api/browser/open-file', () => ({
  openFile: mocks.openFile,
}));

vi.mock('@core/features/workbench/api/browser/task-composition-selectors', () => ({
  getTaskComposition: mocks.getTaskComposition,
}));

vi.mock('@core/features/workspaces/api/browser/stores/workspace-registry', () => ({
  workspaceRegistry: { get: mocks.getWorkspace },
}));

vi.mock('@core/primitives/desktop-host/browser/host-client', () => ({
  getHostClient: async () => ({ openPath: mocks.openPath }),
}));

vi.mock('@core/primitives/telemetry/browser/focus-tracker', () => ({
  focusTracker: { transition: mocks.transition },
}));

describe('workspace file opening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTaskStore.mockReturnValue({ workspaceId: 'workspace-1' });
    mocks.getWorkspace.mockReturnValue({
      workspaceId: 'workspace-1',
      path: '/repo',
    });
    mocks.openPath.mockResolvedValue({ success: true, data: undefined });
  });

  it('resolves a task-relative path and opens it through the openFile seam with reveal', async () => {
    await openFileInTaskEditor('project-1', 'task-1', 'src/chat-link.ts');

    expect(mocks.openFile).toHaveBeenCalledWith(
      hostFileRefFromNativePath('/repo/src/chat-link.ts'),
      { context: { projectId: 'project-1', taskId: 'task-1' }, target: 'active', reveal: true }
    );
  });

  it('carries the workspace SSH connection into the file identity', async () => {
    mocks.getWorkspace.mockReturnValue({
      workspaceId: 'workspace-1',
      path: '/repo',
      sshConnectionId: 'ssh-1',
    });

    await openFileInTaskEditor('project-1', 'task-1', 'src/chat-link.ts');

    expect(mocks.openFile).toHaveBeenCalledWith(
      hostFileRefFromNativePath('/repo/src/chat-link.ts', 'ssh-1'),
      expect.anything()
    );
  });

  it('targets the adjacent pane for diff-header opens', async () => {
    await openFileInAdjacentPane('project-1', 'task-1', 'src/diff-link.ts');

    expect(mocks.openFile).toHaveBeenCalledWith(
      hostFileRefFromNativePath('/repo/src/diff-link.ts'),
      {
        context: { projectId: 'project-1', taskId: 'task-1' },
        target: 'right',
        reveal: true,
      }
    );
  });

  it('routes paths that escape the workspace to the external-file flow, not the seam', async () => {
    await openFileInTaskEditor('project-1', 'task-1', '/outside/notes.txt');

    expect(mocks.openFile).not.toHaveBeenCalled();
    expect(mocks.openPath).toHaveBeenCalledWith({ path: '/outside/notes.txt' });
  });
});
