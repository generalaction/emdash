import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal mocks required by ptyManager (no PTY spawning needed for these tests)
// ---------------------------------------------------------------------------

vi.mock('../../main/services/providerStatusCache', () => ({
  providerStatusCache: { get: vi.fn() },
}));

vi.mock('../../main/settings', () => ({
  getProviderCustomConfig: vi.fn().mockReturnValue(undefined),
}));

vi.mock('../../main/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../main/errorTracking', () => ({
  errorTracking: { captureAgentSpawnError: vi.fn(), captureCriticalError: vi.fn() },
}));

vi.mock('fs', () => {
  const m = {
    readFileSync: vi.fn(),
    existsSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    statSync: vi.fn(() => {
      throw new Error('ENOENT');
    }),
    accessSync: vi.fn(),
    readdirSync: vi.fn(),
    constants: { X_OK: 1 },
  };
  return { ...m, default: m };
});

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/emdash-test' } }));
vi.mock('node-pty', () => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

vi.mock('../../main/services/AgentEventService', () => ({
  agentEventService: { getPort: vi.fn(() => 0), getToken: vi.fn(() => '') },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildProviderCliArgs — model via runtimeArgs', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('includes --model <id> when passed as runtimeArgs', async () => {
    const { buildProviderCliArgs } = await import('../../main/services/ptyManager');

    const args = buildProviderCliArgs({
      runtimeArgs: ['--model', 'claude-sonnet-4-6[1m]'],
    });

    expect(args).toEqual(['--model', 'claude-sonnet-4-6[1m]']);
  });

  it('model arg appears after defaultArgs', async () => {
    const { buildProviderCliArgs } = await import('../../main/services/ptyManager');

    const args = buildProviderCliArgs({
      defaultArgs: ['--verbose'],
      runtimeArgs: ['--model', 'claude-haiku-4-5-20251001'],
    });

    expect(args.indexOf('--verbose')).toBeLessThan(args.indexOf('--model'));
  });

  it('model arg appears after autoApproveFlag', async () => {
    const { buildProviderCliArgs } = await import('../../main/services/ptyManager');

    const args = buildProviderCliArgs({
      autoApprove: true,
      autoApproveFlag: '--dangerously-skip-permissions',
      runtimeArgs: ['--model', 'claude-opus-4-6'],
    });

    expect(args.indexOf('--dangerously-skip-permissions')).toBeLessThan(args.indexOf('--model'));
  });
});

describe('resolveProviderCommandConfig — Claude model flag', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('Claude provider has no fastFlag (--fast is not a real Claude Code CLI flag)', async () => {
    const { resolveProviderCommandConfig } = await import('../../main/services/ptyManager');

    const config = resolveProviderCommandConfig('claude');
    expect((config as any)?.fastFlag).toBeUndefined();
  });

  it('resolves autoApproveFlag for Claude', async () => {
    const { resolveProviderCommandConfig } = await import('../../main/services/ptyManager');

    const config = resolveProviderCommandConfig('claude');
    expect(config?.autoApproveFlag).toBe('--dangerously-skip-permissions');
  });
});

describe('provider registry — Claude model support', () => {
  it('Claude provider has no fastFlag defined', async () => {
    const { PROVIDERS } = await import('../../shared/providers/registry');

    const claude = PROVIDERS.find((p) => p.id === 'claude');
    expect((claude as any)?.fastFlag).toBeUndefined();
  });

  it('Claude provider supports --model via CLI (cli field is set)', async () => {
    const { PROVIDERS } = await import('../../shared/providers/registry');

    const claude = PROVIDERS.find((p) => p.id === 'claude');
    expect(claude?.cli).toBe('claude');
  });
});
