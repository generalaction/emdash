import { describe, expect, it } from 'vitest';
import { buildWindowTitle, getCurrentBranch } from './windowTitle';

describe('windowTitle', () => {
  it('falls back to the app name when no project is selected', () => {
    expect(buildWindowTitle(null, null)).toBe('Emdash');
  });

  it('uses the project branch when no task is active', () => {
    const selectedProject = {
      id: 'project-1',
      name: 'emdash',
      path: '/tmp/emdash',
      gitInfo: { isGitRepo: true, branch: 'main' },
    };

    expect(getCurrentBranch(selectedProject, null)).toBe('main');
    expect(buildWindowTitle(selectedProject, null)).toBe('emdash • main');
  });

  it('prefers the active task branch over the project branch', () => {
    const selectedProject = {
      id: 'project-1',
      name: 'emdash',
      path: '/tmp/emdash',
      gitInfo: { isGitRepo: true, branch: 'main' },
    };
    const activeTask = {
      id: 'task-1',
      projectId: 'project-1',
      name: 'Review',
      branch: 'feature/window-title',
      path: '/tmp/emdash-review',
      status: 'active' as const,
    };

    expect(getCurrentBranch(selectedProject, activeTask)).toBe('feature/window-title');
    expect(buildWindowTitle(selectedProject, activeTask)).toBe('emdash • feature/window-title');
  });
});
