import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { encodeResourceUri, hostFileRef } from '@emdash/core/primitives/path/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { hostPathFromNative } from '@core/primitives/desktop-runtime/api';
import { openCommandPaletteFile } from './open-command-palette-file';

const mocks = vi.hoisted(() => ({
  openFile: vi.fn(),
}));

vi.mock('@core/features/workbench/api/browser/open-file', () => ({
  openFile: mocks.openFile,
}));

const fileRef = hostFileRef(LOCAL_HOST_REF, hostPathFromNative('/repo/src/command-k.ts'));
const resource = encodeResourceUri(fileRef);

describe('openCommandPaletteFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the selected workspace file and navigates to its task', () => {
    const dismiss = vi.fn();
    const navigate = vi.fn();

    openCommandPaletteFile(
      {
        resource,
        projectId: 'project-1',
        taskId: 'task-1',
      },
      dismiss,
      navigate
    );

    expect(mocks.openFile).toHaveBeenCalledWith(fileRef, {
      context: { projectId: 'project-1', taskId: 'task-1' },
      reveal: true,
    });
    expect(dismiss).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(
      taskViewDef({ projectId: 'project-1', taskId: 'task-1' })
    );
  });

  it('ignores file results without a task identity', () => {
    const dismiss = vi.fn();
    const navigate = vi.fn();

    openCommandPaletteFile(
      {
        resource,
        projectId: null,
        taskId: null,
      },
      dismiss,
      navigate
    );

    expect(mocks.openFile).not.toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
