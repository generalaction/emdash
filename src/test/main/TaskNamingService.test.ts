import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { inferTaskNameFromProvider } from '../../main/services/TaskNamingService';

const { resolveProviderCommandConfigMock, spawnMock } = vi.hoisted(() => ({
  resolveProviderCommandConfigMock: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock('../../main/services/ptyManager', () => ({
  resolveProviderCommandConfig: resolveProviderCommandConfigMock,
}));

vi.mock('../../main/settings', () => ({
  getProviderCustomConfig: vi.fn(() => null),
  getAppSettings: vi.fn(() => ({})),
}));

vi.mock('../../main/lib/logger', () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/emdash-test' },
}));

vi.mock('child_process', () => ({ spawn: spawnMock }));

function makeChild(stdout: string, exitCode: number = 0) {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.kill = vi.fn();

  // Emit stdout data and close asynchronously
  setTimeout(() => {
    child.stdout.emit('data', Buffer.from(stdout));
    child.emit('close', exitCode);
  }, 0);

  return child;
}

const RESOLVED_WITH_UTILITY = {
  provider: {
    id: 'test-provider',
    utilityCliArgs: ['-p', '--tools', ''],
  },
  cli: 'test-cli',
};

describe('inferTaskNameFromProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when provider has no resolved config', async () => {
    resolveProviderCommandConfigMock.mockReturnValue(null);
    const result = await inferTaskNameFromProvider('unknown', 'fix the login bug', '/tmp');
    expect(result).toBeNull();
  });

  it('returns null when provider has no utilityCliArgs', async () => {
    resolveProviderCommandConfigMock.mockReturnValue({
      provider: { id: 'test-provider' },
      cli: 'test-cli',
    });
    const result = await inferTaskNameFromProvider('test-provider', 'fix the login bug', '/tmp');
    expect(result).toBeNull();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('spawns the CLI with utility args and the prompt', async () => {
    resolveProviderCommandConfigMock.mockReturnValue(RESOLVED_WITH_UTILITY);
    spawnMock.mockReturnValue(makeChild('fix-login-bug'));

    await inferTaskNameFromProvider('test-provider', 'fix the login bug', '/tmp/project');

    expect(spawnMock).toHaveBeenCalledWith(
      'test-cli',
      expect.arrayContaining(['-p', '--tools', '']),
      expect.objectContaining({ cwd: '/tmp/project' })
    );
  });

  it('returns a normalized slug from CLI output', async () => {
    resolveProviderCommandConfigMock.mockReturnValue(RESOLVED_WITH_UTILITY);
    spawnMock.mockReturnValue(makeChild('fix-login-bug\n'));

    const result = await inferTaskNameFromProvider('test-provider', 'fix the login bug', '/tmp');
    expect(result).toBe('fix-login-bug');
  });

  it('takes only the first line of CLI output', async () => {
    resolveProviderCommandConfigMock.mockReturnValue(RESOLVED_WITH_UTILITY);
    spawnMock.mockReturnValue(makeChild('fix-login-bug\nsome explanation text'));

    const result = await inferTaskNameFromProvider('test-provider', 'fix the login bug', '/tmp');
    expect(result).toBe('fix-login-bug');
  });

  it('normalizes uppercase and spaces in CLI output', async () => {
    resolveProviderCommandConfigMock.mockReturnValue(RESOLVED_WITH_UTILITY);
    spawnMock.mockReturnValue(makeChild('Fix Login Bug'));

    const result = await inferTaskNameFromProvider('test-provider', 'fix the login bug', '/tmp');
    expect(result).toBe('fix-login-bug');
  });

  it('strips leading and trailing hyphens', async () => {
    resolveProviderCommandConfigMock.mockReturnValue(RESOLVED_WITH_UTILITY);
    spawnMock.mockReturnValue(makeChild('---fix-login---'));

    const result = await inferTaskNameFromProvider('test-provider', 'fix the login bug', '/tmp');
    expect(result).toBe('fix-login');
  });

  it('truncates output to 40 characters', async () => {
    resolveProviderCommandConfigMock.mockReturnValue(RESOLVED_WITH_UTILITY);
    spawnMock.mockReturnValue(
      makeChild('a-very-long-branch-name-that-exceeds-the-maximum-allowed-length')
    );

    const result = await inferTaskNameFromProvider('test-provider', 'do something', '/tmp');
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(40);
  });

  it('returns null when output is too short after normalization', async () => {
    resolveProviderCommandConfigMock.mockReturnValue(RESOLVED_WITH_UTILITY);
    spawnMock.mockReturnValue(makeChild('ab'));

    const result = await inferTaskNameFromProvider('test-provider', 'fix the login bug', '/tmp');
    expect(result).toBeNull();
  });

  it('returns null when CLI exits with non-zero code', async () => {
    resolveProviderCommandConfigMock.mockReturnValue(RESOLVED_WITH_UTILITY);
    spawnMock.mockReturnValue(makeChild('fix-login-bug', 1));

    const result = await inferTaskNameFromProvider('test-provider', 'fix the login bug', '/tmp');
    expect(result).toBeNull();
  });

  it('returns null on spawn error', async () => {
    resolveProviderCommandConfigMock.mockReturnValue(RESOLVED_WITH_UTILITY);

    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.kill = vi.fn();
    setTimeout(() => child.emit('error', new Error('ENOENT')), 0);
    spawnMock.mockReturnValue(child);

    const result = await inferTaskNameFromProvider('test-provider', 'fix the login bug', '/tmp');
    expect(result).toBeNull();
  });
});
