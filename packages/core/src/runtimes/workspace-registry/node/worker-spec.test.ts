import { describe, expect, it } from 'vitest';
import { workspaceRegistryWorkerSpec, type WorkspaceRegistryWorkerSpecInput } from './worker-spec';

describe('workspaceRegistryWorkerSpec', () => {
  it('restarts the durable index indefinitely with bounded backoff', () => {
    const env = { PATH: '/usr/bin' };
    const [component, options] = workspaceRegistryWorkerSpec({
      executable: '/w/workspace-registry.mjs',
      env,
      dependencies: {} as WorkspaceRegistryWorkerSpecInput['dependencies'],
      databasePath: '/data/workspace-registry.db',
    });
    expect(component.id).toBe('workspace-registry');
    expect(options.name).toBe('workspace-registry');
    expect(options.env).toBe(env);
    expect(options.supervision?.restart).toBe('on-failure');
    if (options.supervision?.restart !== 'on-failure') throw new Error('Missing supervision');
    expect(options.supervision.schedule.delayFor(0)).toBe(250);
    expect(options.supervision.schedule.delayFor(4)).toBe(30_000);
    expect(options.supervision.schedule.delayFor(100)).toBe(30_000);
    expect(options.shutdownGraceMs).toBe(3_000);
    expect(component.configSchema.parse(options.config)).toEqual({
      databasePath: '/data/workspace-registry.db',
    });
  });
});
