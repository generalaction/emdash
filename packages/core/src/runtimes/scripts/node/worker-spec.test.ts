import { describe, expect, it } from 'vitest';
import { scriptsWorkerSpec } from './worker-spec';

describe('scriptsWorkerSpec', () => {
  it('keeps the worker process env separate from the user shell env', () => {
    const env = { ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production' };
    const userEnv = { PATH: '/user/bin', USER_VALUE: 'kept' };

    const [component, options] = scriptsWorkerSpec({
      executable: '/w/scripts.mjs',
      env,
      userEnv,
    });

    expect(component.id).toBe('scripts');
    expect(options.env).toBe(env);
    expect(component.configSchema.parse(options.config)).toEqual({ userEnv });
  });
});
