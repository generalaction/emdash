import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openFileInAdjacentPane, openFileInTaskEditor } from './open-file-in-file-editor';

const mocks = vi.hoisted(() => ({
  exists: vi.fn(),
  getTaskComposition: vi.fn(),
  getTaskStore: vi.fn(),
  getWorkspace: vi.fn(),
  openPath: vi.fn(),
  toastError: vi.fn(),
  transition: vi.fn(),
}));

vi.mock('@emdash/ui/react/primitives', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: Object.assign(vi.fn(), { error: mocks.toastError }),
}));

vi.mock('@core/features/editor/api/browser/client', () => ({
  getEditorClient: vi.fn(async () => ({
    fs: { exists: mocks.exists },
  })),
}));

vi.mock('@core/features/tasks/api/browser/task-state/task-selectors', () => ({
  asProvisioned: (task: unknown) => task,
  getTaskStore: mocks.getTaskStore,
}));

vi.mock('@core/features/workbench/api/browser/task-composition-selectors', () => ({
  getTaskComposition: mocks.getTaskComposition,
}));

vi.mock('@core/features/workspaces/api/browser/stores/workspace-registry', () => ({
  workspaceRegistry: { get: mocks.getWorkspace },
}));

vi.mock('@renderer/lib/runtime/desktop-host-client', () => ({
  rpc: { app: { openPath: mocks.openPath } },
}));

vi.mock('@renderer/utils/focus-tracker', () => ({
  focusTracker: { transition: mocks.transition },
}));

describe('workspace file opening', () => {
  const openWorkspaceFile = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTaskStore.mockReturnValue({ workspaceId: 'workspace-1' });
    mocks.getWorkspace.mockReturnValue({
      workspaceId: 'workspace-1',
      path: '/repo',
    });
    mocks.getTaskComposition.mockReturnValue({ openWorkspaceFile });
    mocks.exists.mockResolvedValue({ success: true, data: true });
  });

  it('opens and reveals a workspace file in the active pane', async () => {
    await openFileInTaskEditor('project-1', 'task-1', 'src/chat-link.ts');

    expect(mocks.exists).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      relative: 'src/chat-link.ts',
    });
    expect(openWorkspaceFile).toHaveBeenCalledWith('/repo/src/chat-link.ts', 'active');
    expect(mocks.transition).toHaveBeenCalledWith({ mainPanel: 'editor' }, 'panel_switch');
  });

  it('uses the same open-and-reveal intent for an adjacent pane', async () => {
    await openFileInAdjacentPane('project-1', 'task-1', 'src/diff-link.ts');

    expect(openWorkspaceFile).toHaveBeenCalledWith('/repo/src/diff-link.ts', 'right');
  });

  it('does not change editor or sidebar state when the file no longer exists', async () => {
    mocks.exists.mockResolvedValue({ success: true, data: false });

    await openFileInTaskEditor('project-1', 'task-1', 'src/deleted.ts');

    expect(openWorkspaceFile).not.toHaveBeenCalled();
    expect(mocks.transition).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith('File not found in workspace: src/deleted.ts');
  });
});
