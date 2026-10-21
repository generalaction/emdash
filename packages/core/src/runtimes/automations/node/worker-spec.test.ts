import { describe, expect, it } from 'vitest';
import { automationsWorkerSpec, type AutomationsWorkerSpecInput } from './worker-spec';

describe('automationsWorkerSpec', () => {
  it('keeps default restart with a 3s shutdown grace', () => {
    const env = { PATH: '/usr/bin' };
    const [component, options] = automationsWorkerSpec({
      executable: '/w/automations.mjs',
      env,
      dependencies: {} as AutomationsWorkerSpecInput['dependencies'],
      dbFile: '/data/automations.db',
    });
    expect(component.id).toBe('automations');
    expect(options.name).toBe('automations');
    expect(options.env).toBe(env);
    expect(options.supervision).toBeUndefined();
    expect(options.shutdownGraceMs).toBe(3_000);
    expect(component.configSchema.parse(options.config)).toEqual({
      dbFile: '/data/automations.db',
    });
  });
});
