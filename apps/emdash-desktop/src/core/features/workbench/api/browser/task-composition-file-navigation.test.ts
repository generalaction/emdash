import { describe, expect, it, vi } from 'vitest';
import { TaskComposition } from '@core/features/workbench/api/browser/task-composition';

function createTaskCompositionHarness() {
  const open = vi.fn();
  const revealFile = vi.fn();
  const focusRegion = vi.fn();
  const openSidebarTab = vi.fn();
  const taskView = Object.create(TaskComposition.prototype) as TaskComposition;

  Object.defineProperties(taskView, {
    editorView: { value: { revealFile } },
    paneLayout: { value: { open } },
    chrome: { value: { commands: { focusRegion, openSidebarTab } } },
  });

  return {
    open,
    revealFile,
    focusRegion,
    openSidebarTab,
    taskView,
  };
}

describe('TaskComposition workspace file navigation', () => {
  it('reveals an already-open file without opening another tab', () => {
    const harness = createTaskCompositionHarness();

    harness.taskView.revealWorkspaceFile('/repo/src/already-open.ts');

    expect(harness.open).not.toHaveBeenCalled();
    expect(harness.openSidebarTab).toHaveBeenCalledWith('files');
    expect(harness.revealFile).toHaveBeenCalledWith('/repo/src/already-open.ts');
  });
});
