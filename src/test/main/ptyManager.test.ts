import { beforeEach, describe, expect, it, vi } from 'vitest';

const providerStatusGetMock = vi.fn();
const getProviderCustomConfigMock = vi.fn();
const execFileSyncMock = vi.fn();

vi.mock('child_process', () => ({
  execFileSync: execFileSyncMock,
}));

vi.mock('../../main/services/providerStatusCache', () => ({
  providerStatusCache: {
    get: providerStatusGetMock,
  },
}));

vi.mock('../../main/settings', () => ({
  getProviderCustomConfig: getProviderCustomConfigMock,
}));

vi.mock('../../main/lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../main/errorTracking', () => ({
  errorTracking: {
    captureAgentSpawnError: vi.fn(),
    captureCriticalError: vi.fn(),
  },
}));

describe('ptyManager provider command resolution', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    providerStatusGetMock.mockReturnValue({
      installed: true,
      path: '/usr/local/bin/codex',
    });
    getProviderCustomConfigMock.mockReturnValue(undefined);
  });

  it('resolves provider command config from custom settings', async () => {
    getProviderCustomConfigMock.mockReturnValue({
      cli: 'codex-custom',
      resumeFlag: 'resume --last',
      defaultArgs: '--model gpt-5',
      autoApproveFlag: '--dangerously-bypass-approvals-and-sandbox',
      initialPromptFlag: '',
    });

    const { resolveProviderCommandConfig } = await import('../../main/services/ptyManager');
    const config = resolveProviderCommandConfig('codex');

    expect(config?.cli).toBe('codex-custom');
    expect(config?.resumeFlag).toBe('resume --last');
    expect(config?.defaultArgs).toEqual(['--model', 'gpt-5']);
    expect(config?.autoApproveFlag).toBe('--dangerously-bypass-approvals-and-sandbox');
    expect(config?.initialPromptFlag).toBe('');
  });

  it('builds provider CLI args consistently from resolved flags', async () => {
    const { buildProviderCliArgs } = await import('../../main/services/ptyManager');

    const args = buildProviderCliArgs({
      resume: true,
      resumeFlag: 'resume --last',
      defaultArgs: ['--model', 'gpt-5'],
      autoApprove: true,
      autoApproveFlag: '--dangerously-bypass-approvals-and-sandbox',
      initialPrompt: 'hello world',
      initialPromptFlag: '',
      useKeystrokeInjection: false,
    });

    expect(args).toEqual([
      'resume',
      '--last',
      '--model',
      'gpt-5',
      '--dangerously-bypass-approvals-and-sandbox',
      'hello world',
    ]);
  });

  it('falls back when custom CLI needs shell parsing', async () => {
    getProviderCustomConfigMock.mockReturnValue({
      cli: 'codex --dangerously-bypass-approvals-and-sandbox',
    });

    const { startDirectPty } = await import('../../main/services/ptyManager');
    const proc = startDirectPty({
      id: 'codex-main-shell-fallback',
      providerId: 'codex',
      cwd: '/tmp/task',
    });

    expect(proc).toBeNull();
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });
});
