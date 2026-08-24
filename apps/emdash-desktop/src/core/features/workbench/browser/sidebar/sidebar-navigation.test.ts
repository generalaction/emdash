import { describe, expect, it } from 'vitest';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import type { NavigationEvent } from '@core/primitives/navigation/browser/navigation-store';
import { taskProjectRevealTarget } from './sidebar-navigation';

function taskNavigation(kind: NavigationEvent['kind']): NavigationEvent {
  return {
    from: undefined,
    to: taskViewDef({ projectId: 'project-1', taskId: 'task-1' }),
    kind,
  };
}

describe('taskProjectRevealTarget', () => {
  it('does not reveal a Project during startup or history restoration', () => {
    expect(taskProjectRevealTarget(taskNavigation('restoration'))).toBeUndefined();
  });

  it('reveals a Project after explicit task navigation', () => {
    expect(taskProjectRevealTarget(taskNavigation('traversal'))).toEqual({
      projectId: 'project-1',
      taskId: 'task-1',
    });
  });
});
