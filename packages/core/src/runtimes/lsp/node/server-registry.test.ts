import { err, ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import { resolveLanguageServer } from './server-registry';

describe('language server resolution', () => {
  it('uses the host-selected executable and captured environment without constructing shell text', async () => {
    const resolver = {
      resolve: vi.fn(async () =>
        ok({
          id: 'typescript-language-server',
          command: 'typescript-language-server',
          path: '/tools with spaces/typescript-language-server',
          realpath: '/tools with spaces/lib/cli.mjs',
          source: { kind: 'auto' as const },
        })
      ),
    };
    const env = { PATH: '/host/bin', PROJECT_SETTING: 'value' };
    const launch = await resolveLanguageServer('typescript', resolver, env);
    expect(launch.command).toBe('/tools with spaces/typescript-language-server');
    expect(launch.args).toEqual(['--stdio']);
    expect(launch.env).toEqual(env);
    expect(resolver.resolve).toHaveBeenCalledWith('typescript-language-server');
  });
  it('provides actionable guidance when the server is absent on this host', async () => {
    const resolver = {
      resolve: vi.fn(async () =>
        err({ type: 'missing' as const, id: 'typescript-language-server' })
      ),
    };
    await expect(resolveLanguageServer('typescript', resolver, {})).rejects.toThrow(
      /host.*dependencies/i
    );
  });
});
