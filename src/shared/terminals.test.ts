import { describe, expect, it } from 'vitest';
import { createScriptTerminalId } from './terminals';

describe('createScriptTerminalId', () => {
  it('is deterministic for the same project/scope/script tuple', async () => {
    const first = await createScriptTerminalId({
      projectId: 'project-1',
      scopeId: 'workspace:main',
      type: 'setup',
      script: 'pnpm install',
    });
    const second = await createScriptTerminalId({
      projectId: 'project-1',
      scopeId: 'workspace:main',
      type: 'setup',
      script: 'pnpm install',
    });

    expect(first).toBe(second);
  });

  it('changes when scope changes (task vs workspace identity)', async () => {
    const taskScoped = await createScriptTerminalId({
      projectId: 'project-1',
      scopeId: 'task-1',
      type: 'run',
      script: 'pnpm dev',
    });
    const workspaceScoped = await createScriptTerminalId({
      projectId: 'project-1',
      scopeId: 'workspace:feature/a',
      type: 'run',
      script: 'pnpm dev',
    });

    expect(taskScoped).not.toBe(workspaceScoped);
  });

  it('keeps backward compatibility with legacy taskId argument', async () => {
    const viaScopeId = await createScriptTerminalId({
      projectId: 'project-1',
      scopeId: 'task-1',
      type: 'teardown',
      script: 'echo done',
    });
    const viaTaskId = await createScriptTerminalId({
      projectId: 'project-1',
      taskId: 'task-1',
      type: 'teardown',
      script: 'echo done',
    });

    expect(viaScopeId).toBe(viaTaskId);
  });
});
