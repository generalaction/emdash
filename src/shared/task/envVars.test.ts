import { describe, expect, it } from 'vitest';
import { getTaskEnvVars, type TaskEnvContext } from './envVars';

describe('getTaskEnvVars', () => {
  const baseCtx: TaskEnvContext = {
    taskId: 'task-abc-123',
    taskName: 'Fix Login Bug',
    taskPath: '/home/user/worktrees/fix-login-bug',
    projectPath: '/home/user/projects/myapp',
    defaultBranch: 'main',
  };

  it('returns all six env vars', () => {
    const vars = getTaskEnvVars(baseCtx);
    expect(Object.keys(vars)).toHaveLength(6);
    expect(vars).toHaveProperty('EMDASH_TASK_ID');
    expect(vars).toHaveProperty('EMDASH_TASK_NAME');
    expect(vars).toHaveProperty('EMDASH_TASK_PATH');
    expect(vars).toHaveProperty('EMDASH_ROOT_PATH');
    expect(vars).toHaveProperty('EMDASH_DEFAULT_BRANCH');
    expect(vars).toHaveProperty('EMDASH_PORT');
  });

  it('passes through taskId, taskPath, projectPath directly', () => {
    const vars = getTaskEnvVars(baseCtx);
    expect(vars.EMDASH_TASK_ID).toBe('task-abc-123');
    expect(vars.EMDASH_TASK_PATH).toBe('/home/user/worktrees/fix-login-bug');
    expect(vars.EMDASH_ROOT_PATH).toBe('/home/user/projects/myapp');
  });

  it('slugifies the task name', () => {
    const vars = getTaskEnvVars(baseCtx);
    expect(vars.EMDASH_TASK_NAME).toBe('fix-login-bug');
  });

  it('strips leading/trailing hyphens from slug', () => {
    const vars = getTaskEnvVars({ ...baseCtx, taskName: '---Hello World---' });
    expect(vars.EMDASH_TASK_NAME).toBe('hello-world');
  });

  it('falls back to "task" when name slugifies to empty', () => {
    const vars = getTaskEnvVars({ ...baseCtx, taskName: '!!!' });
    expect(vars.EMDASH_TASK_NAME).toBe('task');
  });

  it('defaults defaultBranch to "main"', () => {
    const { defaultBranch: _, ...ctx } = baseCtx;
    const vars = getTaskEnvVars(ctx as TaskEnvContext);
    expect(vars.EMDASH_DEFAULT_BRANCH).toBe('main');
  });

  it('uses provided defaultBranch', () => {
    const vars = getTaskEnvVars({ ...baseCtx, defaultBranch: 'develop' });
    expect(vars.EMDASH_DEFAULT_BRANCH).toBe('develop');
  });

  it('generates a port in the 50000-59990 range', () => {
    const vars = getTaskEnvVars(baseCtx);
    const port = Number(vars.EMDASH_PORT);
    expect(port).toBeGreaterThanOrEqual(50000);
    expect(port).toBeLessThanOrEqual(59990);
  });

  it('generates a port that is a multiple of 10', () => {
    const vars = getTaskEnvVars(baseCtx);
    const port = Number(vars.EMDASH_PORT);
    expect(port % 10).toBe(0);
  });

  it('generates stable port for same input', () => {
    const a = getTaskEnvVars(baseCtx);
    const b = getTaskEnvVars(baseCtx);
    expect(a.EMDASH_PORT).toBe(b.EMDASH_PORT);
  });

  it('uses portSeed over taskPath when provided', () => {
    const withSeed = getTaskEnvVars({ ...baseCtx, portSeed: 'custom-seed' });
    expect(typeof withSeed.EMDASH_PORT).toBe('string');
    expect(Number(withSeed.EMDASH_PORT)).toBeGreaterThanOrEqual(50000);
  });
});
