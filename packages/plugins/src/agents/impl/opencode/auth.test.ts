import type { AgentAuthContext } from '@emdash/core/services/agent-plugins/api/plugins';
import { describe, expect, it, vi } from 'vitest';
import { opencodeAuthStatus } from './auth';

function ctx(overrides: Partial<AgentAuthContext> = {}): AgentAuthContext {
  return {
    cli: 'opencode',
    env: {},
    exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    fs: {
      read: vi.fn(),
      write: vi.fn(),
      delete: vi.fn(),
      exists: vi.fn(),
      list: vi.fn(),
    },
    ...overrides,
  };
}

describe('opencodeAuthStatus', () => {
  it('reports authenticated from provider API keys without probing the CLI', async () => {
    const exec = vi.fn();

    await expect(
      opencodeAuthStatus(ctx({ env: { OPENAI_API_KEY: 'test-key' }, exec }))
    ).resolves.toEqual({ kind: 'authenticated' });
    expect(exec).not.toHaveBeenCalled();
  });

  it('reports authenticated from an OrcaRouter API key without probing the CLI', async () => {
    const exec = vi.fn();

    await expect(
      opencodeAuthStatus(ctx({ env: { ORCAROUTER_API_KEY: 'sk-orca-test' }, exec }))
    ).resolves.toEqual({ kind: 'authenticated' });
    expect(exec).not.toHaveBeenCalled();
  });

  it.each(['http://127.0.0.1:8080/v1', 'http://localhost:11434/v1', 'http://[::1]:8080/v1'])(
    'reports authenticated for loopback OPENAI_BASE_URL (%s) without probing the CLI',
    async (url) => {
      const exec = vi.fn();

      await expect(
        opencodeAuthStatus(ctx({ env: { OPENAI_BASE_URL: url }, exec }))
      ).resolves.toEqual({ kind: 'authenticated' });
      expect(exec).not.toHaveBeenCalled();
    }
  );

  it.each(['https://api.example.com/v1', 'not-a-url', 'ftp://127.0.0.1/v1'])(
    'falls back to opencode auth list when OPENAI_BASE_URL (%s) is not a loopback HTTP endpoint',
    async (url) => {
      const exec = vi.fn().mockResolvedValue({
        stdout: 'Credentials ~/.local/share/opencode/auth.json\n0 credentials',
        stderr: '',
      });

      await expect(
        opencodeAuthStatus(ctx({ env: { OPENAI_BASE_URL: url }, exec }))
      ).resolves.toEqual({ kind: 'unauthenticated' });
      expect(exec).toHaveBeenCalledWith('opencode', ['auth', 'list'], { timeout: 5000 });
    }
  );

  it('reports authenticated when opencode auth list reports credentials', async () => {
    const exec = vi.fn().mockResolvedValue({
      stdout: 'Credentials ~/.local/share/opencode/auth.json\nAnthropic api\n1 credentials',
      stderr: '',
    });

    await expect(opencodeAuthStatus(ctx({ exec }))).resolves.toEqual({ kind: 'authenticated' });
    expect(exec).toHaveBeenCalledWith('opencode', ['auth', 'list'], { timeout: 5000 });
  });

  it('reports unauthenticated when opencode auth list reports zero credentials', async () => {
    const exec = vi.fn().mockResolvedValue({
      stdout: 'Credentials ~/.local/share/opencode/auth.json\n0 credentials',
      stderr: '',
    });

    await expect(opencodeAuthStatus(ctx({ exec }))).resolves.toEqual({ kind: 'unauthenticated' });
  });

  it('reports unknown when opencode auth list output is unrecognized', async () => {
    const exec = vi.fn().mockRejectedValue({
      code: 1,
      stdout: '',
      stderr: "error: unknown command 'auth'",
    });

    await expect(opencodeAuthStatus(ctx({ exec }))).resolves.toEqual({ kind: 'unknown' });
  });
});
