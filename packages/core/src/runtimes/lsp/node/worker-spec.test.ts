import { describe, expect, it } from 'vitest';
import { lspWorkerSpec } from './worker-spec';

describe('LSP worker specification', () => {
  it('declares host environment and dependency resolution as explicit requirements', () => {
    const [component, options] = lspWorkerSpec({
      executable: '/workers/lsp.js',
      env: {},
      dependencies: {} as never,
    });
    expect(component.id).toBe('lsp');
    expect(Object.keys(component.requirements).sort()).toEqual(['hostDependencies', 'userEnv']);
    expect(options.config).toEqual({});
    expect(options.name).toBe('lsp');
  });
});
