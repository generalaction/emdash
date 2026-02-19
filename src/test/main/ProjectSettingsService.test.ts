import path from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp'),
    getName: vi.fn().mockReturnValue('emdash-test'),
    getVersion: vi.fn().mockReturnValue('0.0.0-test'),
  },
}));

vi.mock('../../main/services/DatabaseService', () => ({
  databaseService: {
    getProjectById: vi.fn(),
    updateProjectSettings: vi.fn(),
  },
}));

import {
  INSIDE_PROJECT_WORKTREE_BASE_PATH,
  getDefaultWorktreeBasePath,
  resolveWorktreeBasePath,
} from '../../main/services/ProjectSettingsService';

describe('ProjectSettingsService worktree base path helpers', () => {
  it('uses sibling ../worktrees as default base path', () => {
    const projectPath = path.resolve('/tmp', 'my-project');
    expect(getDefaultWorktreeBasePath(projectPath)).toBe(
      path.resolve(projectPath, '..', 'worktrees')
    );
  });

  it('resolves null/empty configured paths to default', () => {
    const projectPath = path.resolve('/tmp', 'my-project');
    const expected = path.resolve(projectPath, '..', 'worktrees');
    expect(resolveWorktreeBasePath(projectPath, null)).toBe(expected);
    expect(resolveWorktreeBasePath(projectPath, '')).toBe(expected);
    expect(resolveWorktreeBasePath(projectPath, '   ')).toBe(expected);
  });

  it('resolves inside-project shorthand to .worktrees', () => {
    const projectPath = path.resolve('/tmp', 'my-project');
    expect(resolveWorktreeBasePath(projectPath, INSIDE_PROJECT_WORKTREE_BASE_PATH)).toBe(
      path.resolve(projectPath, '.worktrees')
    );
  });

  it('resolves custom relative paths from project root', () => {
    const projectPath = path.resolve('/tmp', 'my-project');
    expect(resolveWorktreeBasePath(projectPath, 'custom/worktrees')).toBe(
      path.resolve(projectPath, 'custom/worktrees')
    );
  });

  it('resolves absolute custom paths as-is', () => {
    const projectPath = path.resolve('/tmp', 'my-project');
    const absoluteTarget = path.resolve('/tmp', 'shared-worktrees');
    expect(resolveWorktreeBasePath(projectPath, absoluteTarget)).toBe(absoluteTarget);
  });
});
