import { describe, expect, it, vi } from 'vitest';
import { buildWorkspaceAcpAgentEnv, resolveWorkspaceAcpSpawnContext } from './host';

describe('workspace ACP host helpers', () => {
  it('builds an allowlisted agent environment', () => {
    const env = buildWorkspaceAcpAgentEnv({
      PATH: '/usr/bin',
      HOME: '/home/alice',
      USER: 'alice',
      SHELL: '/bin/zsh',
      OPENAI_API_KEY: 'openai',
      SECRET_INTERNAL_TOKEN: 'secret',
    });

    expect(env).toMatchObject({
      PATH: '/usr/bin',
      HOME: '/home/alice',
      USER: 'alice',
      SHELL: '/bin/zsh',
      OPENAI_API_KEY: 'openai',
      TERM_PROGRAM: 'emdash',
    });
    expect(env).not.toHaveProperty('SECRET_INTERNAL_TOKEN');
  });

  it('resolves the provider binary name through the injected resolver', async () => {
    const resolveExecutable = vi.fn(async (binaryName: string) => `/bin/${binaryName}`);

    const context = await resolveWorkspaceAcpSpawnContext('codex', {
      env: { PATH: '/usr/bin', HOME: '/tmp/home', USER: 'alice' },
      resolveExecutable,
    });

    expect(resolveExecutable).toHaveBeenCalledWith('codex');
    expect(context.cli).toBe('/bin/codex');
    expect(context.agentEnv.PATH).toBe('/usr/bin');
  });
});
