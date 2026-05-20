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

describe('buildAgentEnv provider env forwarding', () => {
  it('passes through documented provider launch environment variables', async () => {
    const providerEnv = {
      CLAUDE_CONFIG_DIR: '/tmp/claude-config',
      ANTHROPIC_AUTH_TOKEN: 'anthropic-token',
      ANTHROPIC_BASE_URL: 'https://anthropic.example.test',
      CODEX_HOME: '/tmp/codex-home',
      OPENAI_ORGANIZATION: 'org_123',
      OPENAI_PROJECT: 'proj_123',
      GEMINI_MODEL: 'gemini-2.5-pro',
      GOOGLE_GENAI_API_VERSION: 'v1beta',
      GROK_CODE_XAI_API_KEY: 'xai-key',
      BAILIAN_CODING_PLAN_API_KEY: 'bailian-key',
      GOOSE_PROVIDER: 'openai',
      GOOSE_MODEL: 'gpt-5.1',
      GOOSE_PROVIDER__HOST: 'https://goose.example.test',
      OPENCODE_MODEL: 'anthropic/claude-sonnet-4-5',
      AMP_TOOLBOX: '/tmp/amp-toolbox',
      ALL_PROXY: 'socks5://127.0.0.1:9000',
    };
    Object.assign(process.env, providerEnv, {
      CLAUDE_PROJECT_DIR: '/tmp/hook-owned',
      CODEX_ACCESS_TOKEN: 'do-not-pass',
      GOOSE_TERMINAL: 'do-not-pass',
      TOOLBOX_ACTION: 'do-not-pass',
    });

    const { buildAgentEnv } = await loadPtyEnv();
    const env = buildAgentEnv();

    for (const [key, value] of Object.entries(providerEnv)) {
      expect(env[key]).toBe(value);
    }
    expect(env.CLAUDE_PROJECT_DIR).toBeUndefined();
    expect(env.CODEX_ACCESS_TOKEN).toBeUndefined();
    expect(env.GOOSE_TERMINAL).toBeUndefined();
    expect(env.TOOLBOX_ACTION).toBeUndefined();
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
