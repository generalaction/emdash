import { createEmitter } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import type { NavigationEvent } from '@core/primitives/navigation/browser/navigation-store';
import { SidebarNavigationController, taskProjectRevealTarget } from './sidebar-navigation';

function taskNavigation(
  kind: NavigationEvent['kind'],
  source: NavigationEvent['source']
): NavigationEvent {
  return {
    from: undefined,
    to: taskViewDef({ projectId: 'project-1', taskId: 'task-1' }),
    kind,
    source,
  };
}

describe('taskProjectRevealTarget', () => {
  it('does not reveal a Project during startup restoration', () => {
    expect(taskProjectRevealTarget(taskNavigation('traversal', 'startup'))).toBeUndefined();
  });

  it.each(['direct', 'history'] as const)(
    'reveals a Project after %s task navigation',
    (source) => {
      expect(taskProjectRevealTarget(taskNavigation('traversal', source))).toEqual({
        projectId: 'project-1',
        taskId: 'task-1',
      });
    }
  );

  it('does not reveal a Project for location refinement', () => {
    expect(taskProjectRevealTarget(taskNavigation('refinement', 'view'))).toBeUndefined();
  });
});

describe('SidebarNavigationController', () => {
  it('reveals an unpinned task Project while no sidebar view is mounted', () => {
    const onDidNavigate = createEmitter<NavigationEvent>();
    const revealProject = vi.fn();
    const controller = new SidebarNavigationController(
      { onDidNavigate },
      { revealProject },
      () => false
    );
    controller.activate();

    onDidNavigate.emit(taskNavigation('traversal', 'direct'));

    expect(revealProject).toHaveBeenCalledWith('project-1');
  });

  it('preserves collapsed Projects for pinned tasks', () => {
    const onDidNavigate = createEmitter<NavigationEvent>();
    const revealProject = vi.fn();
    const controller = new SidebarNavigationController(
      { onDidNavigate },
      { revealProject },
      () => true
    );
    controller.activate();

    onDidNavigate.emit(taskNavigation('traversal', 'direct'));

    expect(revealProject).not.toHaveBeenCalled();
  });

  it('stops handling navigation after disposal', () => {
    const onDidNavigate = createEmitter<NavigationEvent>();
    const revealProject = vi.fn();
    const controller = new SidebarNavigationController(
      { onDidNavigate },
      { revealProject },
      () => false
    );
    controller.activate();
    controller.dispose();

    onDidNavigate.emit(taskNavigation('traversal', 'history'));

    expect(revealProject).not.toHaveBeenCalled();
  });

  it('does not subscribe more than once', () => {
    const onDidNavigate = createEmitter<NavigationEvent>();
    const revealProject = vi.fn();
    const controller = new SidebarNavigationController(
      { onDidNavigate },
      { revealProject },
      () => false
    );
    controller.activate();
    controller.activate();

    onDidNavigate.emit(taskNavigation('traversal', 'direct'));

    expect(revealProject).toHaveBeenCalledOnce();
    expect(revealProject).toHaveBeenCalledWith('project-1');
  });
});
