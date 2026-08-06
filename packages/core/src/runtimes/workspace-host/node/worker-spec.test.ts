import { describe, expect, it } from 'vitest';
import { workspaceHostWorkerSpec, type WorkspaceHostWorkerSpecInput } from './worker-spec';

describe('workspaceHostWorkerSpec', () => {
  it('never restarts', () => {
    const env = { PATH: '/usr/bin' };
    const [component, options] = workspaceHostWorkerSpec({
      executable: '/w/workspace-host.mjs',
      env,
      dependencies: {} as WorkspaceHostWorkerSpecInput['dependencies'],
      stateDirectory: '/data/workspace-host',
    });
    expect(component.id).toBe('workspace-host');
    expect(options.name).toBe('workspace-host');
    expect(options.env).toBe(env);
    expect(options.supervision).toEqual({ restart: 'never' });
    expect(component.configSchema.parse(options.config)).toEqual({
      stateDirectory: '/data/workspace-host',
    });
  });
});
