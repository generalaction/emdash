import { describe, expect, it } from 'vitest';
import { terminalsWorkerSpec } from './worker-spec';

describe('terminalsWorkerSpec', () => {
  it('takes the lifecycle policy as a per-app parameter', () => {
    const env = { PATH: '/usr/bin' };
    const userEnv = { PATH: '/user/bin', USER_VALUE: 'kept' };
    const lifecycle = {
      terminal: { kind: 'while-attached', graceMs: 5 * 60_000 },
    } as const;
    const [component, options] = terminalsWorkerSpec({
      executable: '/w/terminals.mjs',
      env,
      userEnv,
      lifecycle,
    });
    expect(component.id).toBe('terminals');
    expect(options.name).toBe('terminals');
    expect(options.env).toBe(env);
    expect(options.supervision).toBeUndefined();
    expect(component.configSchema.parse(options.config)).toEqual({ userEnv, lifecycle });
  });
});
