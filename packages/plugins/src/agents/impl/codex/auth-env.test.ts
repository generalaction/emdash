import { describe, expect, it, vi } from 'vitest';
import { readCodexAuthEnvKeys } from './auth-env';
import { provider } from './index';

describe('Codex authentication environment declarations', () => {
  it('reads only variable names declared by user model providers', async () => {
    const read = vi.fn(
      async () => `
model_provider = "local"
[model_providers.local]
env_key = "LOCAL_API_KEY"
[model_providers.local.env_http_headers]
"X-Tenant" = "CUSTOM_TENANT"
[model_providers.other]
env_key = "LOCAL_API_KEY"
[model_providers.other.http_headers]
"Authorization" = "inline-value-must-not-be-a-name"
[mcp_servers.demo.env]
OTHER_SECRET = "ignored"
`
    );
    expect(await readCodexAuthEnvKeys({ read })).toEqual(['LOCAL_API_KEY', 'CUSTOM_TENANT']);
    expect(read).toHaveBeenCalledExactlyOnceWith('config.toml');
  });

  it('has no additional keys when the user config is absent', async () => {
    expect(await readCodexAuthEnvKeys({ read: async () => null })).toEqual([]);
  });

  it('ignores invalid names and unrelated config shapes', async () => {
    const read = async (): Promise<string> => `
[model_providers.local]
env_key = "INVALID=NAME"
[model_providers.local.env_http_headers]
bad = ""
number = 123
valid = "ORG_TOKEN"
`;
    expect(await readCodexAuthEnvKeys({ read })).toEqual(['ORG_TOKEN']);
  });

  it('reports invalid TOML without including the input in the error', async () => {
    const read = async (): Promise<string> => 'secret = "fixture-private-value"\nbroken = [';
    await expect(readCodexAuthEnvKeys({ read })).rejects.toThrow(
      /^Cannot parse Codex user config.toml for authentication environment$/
    );
  });

  it('propagates filesystem errors instead of silently dropping credentials', async () => {
    const failure = new Error('Permission denied');
    await expect(
      readCodexAuthEnvKeys({
        read: async () => {
          throw failure;
        },
      })
    ).rejects.toBe(failure);
  });

  it('uses CODEX_HOME and otherwise the user home, never a project directory', () => {
    const resolve = provider.behavior.auth!.environment!.resolveConfigRoot;
    expect(resolve({ env: {}, homeDir: '/home/test', platform: 'linux' })).toBe(
      '/home/test/.codex'
    );
    expect(
      resolve({ env: { CODEX_HOME: '/custom/codex' }, homeDir: '/home/test', platform: 'linux' })
    ).toBe('/custom/codex');
    expect(
      resolve({ env: { CODEX_HOME: 'alternate' }, homeDir: '/home/test', platform: 'linux' })
    ).toBe('/home/test/alternate');
  });
});
