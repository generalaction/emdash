import { describe, expect, it } from 'vitest';
import { ProjectViewStore } from '@renderer/features/projects/stores/project-view';

describe('ProjectViewStore.restoreSnapshot', () => {
  it('restores a persisted pull-request view for git projects', () => {
    const view = new ProjectViewStore();
    view.restoreSnapshot({ activeView: 'pull-request' }, { isGitRepo: true });
    expect(view.activeView).toBe('pull-request');
  });

  it('clamps a persisted pull-request view to tasks for non-git projects', () => {
    const view = new ProjectViewStore();
    view.restoreSnapshot({ activeView: 'pull-request' }, { isGitRepo: false });
    expect(view.activeView).toBe('tasks');
  });

  it('keeps tasks and settings views untouched for non-git projects', () => {
    const tasksView = new ProjectViewStore();
    tasksView.restoreSnapshot({ activeView: 'tasks' }, { isGitRepo: false });
    expect(tasksView.activeView).toBe('tasks');

    const settingsView = new ProjectViewStore();
    settingsView.restoreSnapshot({ activeView: 'settings' }, { isGitRepo: false });
    expect(settingsView.activeView).toBe('settings');
  });
});
