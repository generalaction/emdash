import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { EventEmitter } from 'events';

// ── mocks ────────────────────────────────────────────────────────────

const spawnMock = vi.fn();
const execFileSyncMock = vi.fn();

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-emdash' },
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('../../main/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Inline the cache so we can inspect it directly
const statusMap: Record<string, any> = {};
vi.mock('../../main/services/providerStatusCache', () => ({
  providerStatusCache: {
    load: vi.fn().mockResolvedValue(undefined),
    getAll: () => ({ ...statusMap }),
    get: (id: string) => statusMap[id],
    set: (id: string, v: any) => {
      statusMap[id] = v;
    },
  },
}));

// ── helpers ──────────────────────────────────────────────────────────

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: Mock;
};

/** Create a fake child process that emits events on demand. */
function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

/**
 * Configure spawnMock to return a child that emits the given events.
 * Supports multiple calls by queuing children.
 */
function spawnEmits(
  ...scenarios: Array<{
    stdout?: string;
    stderr?: string;
    closeCode?: number | null;
    error?: NodeJS.ErrnoException;
  }>
) {
  for (const scenario of scenarios) {
    spawnMock.mockImplementationOnce(() => {
      const child = fakeChild();
      // Schedule events on next tick so the caller can attach listeners
      process.nextTick(() => {
        if (scenario.stdout) child.stdout.emit('data', scenario.stdout);
        if (scenario.stderr) child.stderr.emit('data', scenario.stderr);
        if (scenario.error) {
          child.emit('error', scenario.error);
        } else {
          child.emit('close', scenario.closeCode ?? 0);
        }
      });
      return child;
    });
  }
}

/** Simulate `which <command>` returning a path (or throwing if not found). */
function whichReturns(path: string | null) {
  if (path) {
    execFileSyncMock.mockReturnValue(`${path}\n`);
  } else {
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not found');
    });
  }
}

// ── tests ────────────────────────────────────────────────────────────

describe('ConnectionsService – resolveStatus', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    for (const k of Object.keys(statusMap)) delete statusMap[k];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks provider as installed when --version exits with code 0', async () => {
    whichReturns('/usr/local/bin/claude');
    spawnEmits({ stdout: '2.1.56 (Claude Code)\n', closeCode: 0 });

    const { connectionsService } = await import('../../main/services/ConnectionsService');
    await connectionsService.checkProvider('claude', 'manual');

    expect(statusMap.claude?.installed).toBe(true);
    expect(statusMap.claude?.version).toBe('2.1.56');
  });

  it('marks provider as installed when --version exits non-zero but binary exists (resolvedPath)', async () => {
    // Bug scenario: `claude --version` returns non-zero exit code but
    // `which claude` found the binary. Should NOT be marked as 'missing'.
    whichReturns('/usr/local/bin/claude');
    // tryCommands runs the command twice when first attempt is non-success + no error
    spawnEmits(
      { stderr: 'some error output\n', closeCode: 1 },
      { stderr: 'some error output\n', closeCode: 1 }
    );

    const { connectionsService } = await import('../../main/services/ConnectionsService');
    await connectionsService.checkProvider('claude', 'manual');

    expect(statusMap.claude?.installed).toBe(true);
  });

  it('marks provider as installed when binary runs and exits non-zero (no resolvedPath)', async () => {
    // Binary is in PATH for spawn but `which` fails (edge case).
    // The process ran and exited with output → binary exists.
    whichReturns(null);
    spawnEmits(
      { stdout: 'some output\n', closeCode: 1 },
      { stdout: 'some output\n', closeCode: 1 }
    );

    const { connectionsService } = await import('../../main/services/ConnectionsService');
    await connectionsService.checkProvider('claude', 'manual');

    expect(statusMap.claude?.installed).toBe(true);
  });

  it('marks provider as missing when both bare spawn and shell fallback fail', async () => {
    whichReturns(null);
    const err = new Error('spawn claude ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    // Bare spawn ENOENT, shell fallback also fails (command not found in shell either)
    spawnEmits({ error: err }, { stderr: 'command not found: claude\n', closeCode: 127 });

    const { connectionsService } = await import('../../main/services/ConnectionsService');
    await connectionsService.checkProvider('claude', 'manual');

    expect(statusMap.claude?.installed).toBe(false);
  });

  it('falls back to login shell when bare spawn fails with ENOENT and detects installed', async () => {
    // Bare spawn can't find `claude` (not in Electron PATH),
    // but the user's login shell has it in PATH via .zshrc
    whichReturns(null);
    const err = new Error('spawn claude ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    // First: bare spawn fails with ENOENT
    // Second: shell fallback succeeds
    spawnEmits({ error: err }, { stdout: '2.1.56 (Claude Code)\n', closeCode: 0 });

    const { connectionsService } = await import('../../main/services/ConnectionsService');
    await connectionsService.checkProvider('claude', 'manual');

    expect(statusMap.claude?.installed).toBe(true);
    // Verify the second spawn used a shell
    const secondCall = spawnMock.mock.calls[1];
    expect(secondCall).toBeDefined();
    // Should invoke a shell (e.g. /bin/zsh or /bin/bash) with login+interactive flags
    const shellCmd = secondCall[0] as string;
    const shellArgs = secondCall[1] as string[];
    expect(shellArgs.some((a: string) => a.includes('claude'))).toBe(true);
    expect(shellArgs.some((a: string) => a.includes('-l'))).toBe(true);
  });
});
