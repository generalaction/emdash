import { describe, expect, it, vi } from 'vitest';
import { TaskComposition } from './task-composition';

function createTaskCompositionHarness() {
  const open = vi.fn();
  const requestRevealFile = vi.fn();
  const setFocusedRegion = vi.fn();
  const setSidebarCollapsed = vi.fn();
  const setSidebarTab = vi.fn();
  const taskView = Object.create(TaskComposition.prototype) as TaskComposition;

  Object.defineProperties(taskView, {
    editorView: { value: { requestRevealFile } },
    paneLayout: { value: { open } },
    setFocusedRegion: { value: setFocusedRegion },
    setSidebarCollapsed: { value: setSidebarCollapsed },
    setSidebarTab: { value: setSidebarTab },
  });

  return {
    open,
    requestRevealFile,
    setFocusedRegion,
    setSidebarCollapsed,
    setSidebarTab,
    taskView,
  };
}

describe('TaskComposition workspace file navigation', () => {
  it('opens a file and reveals it in the Files sidebar as one intent', () => {
    const harness = createTaskCompositionHarness();

    harness.taskView.openWorkspaceFile('/repo/src/chat-link.ts', 'right');

    expect(harness.open).toHaveBeenCalledWith(
      'file',
      { path: '/repo/src/chat-link.ts' },
      { preview: false, target: 'right' }
    );
    expect(harness.setFocusedRegion).toHaveBeenCalledWith('main');
    expect(harness.setSidebarTab).toHaveBeenCalledWith('files');
    expect(harness.setSidebarCollapsed).toHaveBeenCalledWith(false);
    expect(harness.requestRevealFile).toHaveBeenCalledWith('/repo/src/chat-link.ts');
  });

  it('can reveal an already-open file without opening another tab', () => {
    const harness = createTaskCompositionHarness();

    harness.taskView.revealWorkspaceFile('/repo/src/already-open.ts');

    expect(harness.open).not.toHaveBeenCalled();
    expect(harness.setSidebarTab).toHaveBeenCalledWith('files');
    expect(harness.setSidebarCollapsed).toHaveBeenCalledWith(false);
    expect(harness.requestRevealFile).toHaveBeenCalledWith('/repo/src/already-open.ts');
  });
});
