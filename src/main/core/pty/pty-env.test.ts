import { afterEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const originalEnv = { ...process.env };

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
}

async function loadPtyEnv() {
  vi.resetModules();
  return import('./pty-env');
}

afterEach(() => {
  process.env = { ...originalEnv };
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform);
  }
  vi.resetModules();
});

describe('pty env Windows shell handling', () => {
  it('does not synthesize /bin/bash as SHELL for Windows terminals', async () => {
    setPlatform('win32');
    delete process.env.SHELL;
    process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe';

    const { buildTerminalEnv } = await loadPtyEnv();
    const env = buildTerminalEnv();

    expect(env.SHELL).toBeUndefined();
    expect(env.ComSpec).toBe('C:\\Windows\\System32\\cmd.exe');
  });

  it('does not synthesize /bin/bash when includeShellVar is true on Windows', async () => {
    setPlatform('win32');
    delete process.env.SHELL;
    process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe';

    const { buildAgentEnv } = await loadPtyEnv();
    const env = buildAgentEnv({ includeShellVar: true, agentApiVars: false });

    expect(env.SHELL).toBeUndefined();
    expect(env.ComSpec).toBe('C:\\Windows\\System32\\cmd.exe');
  });

  it('keeps POSIX shell fallback for non-Windows terminal envs', async () => {
    setPlatform('linux');
    delete process.env.SHELL;

    const { buildTerminalEnv } = await loadPtyEnv();
    const env = buildTerminalEnv();

    expect(env.SHELL).toBe('/bin/bash');
  });

  it('adds provider vars while keeping hook variables authoritative', async () => {
    const { buildAgentEnv } = await loadPtyEnv();
    const env = buildAgentEnv({
      agentApiVars: false,
      hook: { port: 1234, ptyId: 'claude:conv-1', token: 'real-token' },
      providerVars: {
        ANTHROPIC_BASE_URL: 'https://example.test',
        EMDASH_HOOK_PORT: '9999',
        EMDASH_PTY_ID: 'wrong',
        EMDASH_HOOK_TOKEN: 'wrong-token',
      },
    });

    expect(env.ANTHROPIC_BASE_URL).toBe('https://example.test');
    expect(env.EMDASH_HOOK_PORT).toBe('1234');
    expect(env.EMDASH_PTY_ID).toBe('claude:conv-1');
    expect(env.EMDASH_HOOK_TOKEN).toBe('real-token');
  });
});
