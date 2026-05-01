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
});
