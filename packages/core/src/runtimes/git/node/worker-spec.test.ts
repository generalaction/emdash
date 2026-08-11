import { describe, expect, it } from 'vitest';
import { gitRuntimeEnv, NON_INTERACTIVE_GIT_ENV } from './non-interactive-env';
import { gitWorkerSpec, type GitWorkerSpecInput } from './worker-spec';

const env = { PATH: '/usr/bin', LANG: 'en_US.UTF-8' };
const dependencies = {} as GitWorkerSpecInput['dependencies'];

describe('gitRuntimeEnv', () => {
  it('composes non-interactive credentials and a stable C locale over the base env', () => {
    expect(gitRuntimeEnv(env)).toEqual({
      PATH: '/usr/bin',
      ...NON_INTERACTIVE_GIT_ENV,
      LC_ALL: 'C',
      LANG: 'C',
      LANGUAGE: 'C',
    });
  });
});

describe('gitWorkerSpec', () => {
  it('gives the worker and its git subprocesses the same composed env', () => {
    const [component, options] = gitWorkerSpec({
      executable: '/w/git.mjs',
      env,
      dependencies,
      gitExecutable: '/usr/local/bin/git',
    });
    expect(component.id).toBe('git');
    expect(options.name).toBe('git');
    expect(options.env).toEqual(gitRuntimeEnv(env));
    expect(options.config.env).toBe(options.env);
    expect(component.configSchema.parse(options.config)).toEqual({
      executable: '/usr/local/bin/git',
      env: gitRuntimeEnv(env),
    });
  });

  it('omits the git executable when absent', () => {
    const [, options] = gitWorkerSpec({ executable: '/w/git.mjs', env, dependencies });
    expect(options.config).not.toHaveProperty('executable');
  });
});
