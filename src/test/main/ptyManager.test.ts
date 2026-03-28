import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const providerStatusGetMock = vi.fn();
const getProviderCustomConfigMock = vi.fn();
const fsReadFileSyncMock = vi.fn();
const fsExistsSyncMock = vi.fn();
const fsWriteFileSyncMock = vi.fn();
const fsMkdirSyncMock = vi.fn();
const fsStatSyncMock = vi.fn();
const fsAccessSyncMock = vi.fn();
const fsReaddirSyncMock = vi.fn();
const agentEventGetPortMock = vi.fn(() => 0);
const agentEventGetTokenMock = vi.fn(() => '');
const nodePtySpawnMock = vi.fn();
const childProcessSpawnMock = vi.fn();

function restoreEnvVar(key: 'LANG' | 'LC_ALL' | 'LC_CTYPE', value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

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

vi.mock('fs', () => {
  const fsMock = {
    readFileSync: (...args: any[]) => fsReadFileSyncMock(...args),
    existsSync: (...args: any[]) => fsExistsSyncMock(...args),
    writeFileSync: (...args: any[]) => fsWriteFileSyncMock(...args),
    mkdirSync: (...args: any[]) => fsMkdirSyncMock(...args),
    statSync: (...args: any[]) => fsStatSyncMock(...args),
    accessSync: (...args: any[]) => fsAccessSyncMock(...args),
    readdirSync: (...args: any[]) => fsReaddirSyncMock(...args),
    constants: { X_OK: 1 },
  };
  return { ...fsMock, default: fsMock };
});

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/emdash-test',
  },
}));

vi.mock('node-pty', () => ({
  spawn: (...args: any[]) => nodePtySpawnMock(...args),
}));

vi.mock('node:child_process', () => ({
  spawn: (...args: any[]) => childProcessSpawnMock(...args),
}));

vi.mock('../../main/services/AgentEventService', () => ({
  agentEventService: {
    getPort: () => agentEventGetPortMock(),
    getToken: () => agentEventGetTokenMock(),
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
    agentEventGetPortMock.mockReturnValue(0);
    agentEventGetTokenMock.mockReturnValue('');
    fsMkdirSyncMock.mockImplementation(() => undefined);
    fsWriteFileSyncMock.mockImplementation(() => undefined);
    fsStatSyncMock.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    fsAccessSyncMock.mockImplementation(() => undefined);
    childProcessSpawnMock.mockReset();
    delete process.env.EMDASH_DISABLE_PTY;
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
      extraArgs: ['--extra-flag'],
      runtimeArgs: ['-c', 'notify=test'],
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
      '--extra-flag',
      '-c',
      'notify=test',
      'hello world',
    ]);
  });

  it('places positional prompt after --full-auto and runtime args for Codex', async () => {
    const { buildProviderCliArgs } = await import('../../main/services/ptyManager');

    const args = buildProviderCliArgs({
      autoApprove: true,
      autoApproveFlag: '--full-auto',
      runtimeArgs: ['-c', 'notify=["sh","-lc","curl ...","sh"]'],
      initialPrompt: 'fix the login bug',
      initialPromptFlag: '',
      useKeystrokeInjection: false,
    });

    expect(args).toEqual([
      '--full-auto',
      '-c',
      'notify=["sh","-lc","curl ...","sh"]',
      'fix the login bug',
    ]);
  });

  it('skips CLI prompt injection for Hermes-style TUI providers', async () => {
    const { buildProviderCliArgs } = await import('../../main/services/ptyManager');

    const args = buildProviderCliArgs({
      resume: true,
      resumeFlag: '--continue',
      initialPrompt: 'scan the repo',
      initialPromptFlag: '',
      useKeystrokeInjection: true,
    });

    expect(args).toEqual(['--continue']);
  });

  it('covers all configured provider auto-approve flags', async () => {
    const { PROVIDERS } = await import('../../shared/providers/registry');
    const { resolveProviderCommandConfig, buildProviderCliArgs, parseShellArgs } = await import(
      '../../main/services/ptyManager'
    );

    const expectedAutoApproveFlags: Record<string, string> = {
      amp: '--dangerously-allow-all',
      autohand: '--unrestricted',
      claude: '--dangerously-skip-permissions',
      charm: '--yolo',
      cline: '--yolo',
      codex: '--full-auto',
      copilot: '--allow-all-tools',
      cursor: '-f',
      gemini: '--yolo',
      kimi: '--yolo',
      kilocode: '--auto',
      mistral: '--auto-approve',
      qwen: '--yolo',
      rovo: '--yolo',
    };

    const providerIdsWithAutoApprove = PROVIDERS.filter((provider) => provider.autoApproveFlag)
      .map((provider) => provider.id)
      .sort();
    expect(providerIdsWithAutoApprove).toEqual(Object.keys(expectedAutoApproveFlags).sort());

    for (const [providerId, expectedFlag] of Object.entries(expectedAutoApproveFlags)) {
      const config = resolveProviderCommandConfig(providerId);
      expect(config?.autoApproveFlag).toBe(expectedFlag);

      const args = buildProviderCliArgs({
        autoApprove: true,
        autoApproveFlag: config?.autoApproveFlag,
      });
      expect(args).toEqual(parseShellArgs(expectedFlag));
    }
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
  });

  it('supports Windows absolute custom CLI paths for direct spawn', async () => {
    const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    });

    try {
      const { parseCustomCliForDirectSpawn } = await import('../../main/services/ptyManager');

      expect(parseCustomCliForDirectSpawn('C:\\Tools\\codex.cmd')).toEqual([
        'C:\\Tools\\codex.cmd',
      ]);
      expect(parseCustomCliForDirectSpawn('"C:\\Program Files\\Codex\\codex.cmd"')).toEqual([
        'C:\\Program Files\\Codex\\codex.cmd',
      ]);
    } finally {
      if (originalPlatformDescriptor) {
        Object.defineProperty(process, 'platform', originalPlatformDescriptor);
      }
    }
  });

  it('adds Codex notify runtime config when hooks are enabled', async () => {
    agentEventGetPortMock.mockReturnValue(43123);

    const { getProviderRuntimeCliArgs } = await import('../../main/services/ptyManager');
    const args = getProviderRuntimeCliArgs({
      providerId: 'codex',
    });

    expect(args).toContain('-c');
    const notifyArg = args.find((arg) => arg.startsWith('notify='));
    expect(notifyArg).toContain('X-Emdash-Event-Type: notification');
    expect(notifyArg).toContain('$EMDASH_HOOK_PORT');
  });

  it('uses a PowerShell file for Codex notify runtime config on Windows', async () => {
    agentEventGetPortMock.mockReturnValue(43123);

    const { getProviderRuntimeCliArgs } = await import('../../main/services/ptyManager');
    const args = getProviderRuntimeCliArgs({
      providerId: 'codex',
      platform: 'win32',
    });

    expect(args).toContain('-c');
    const notifyArg = args.find((arg) => arg.startsWith('notify='));
    expect(notifyArg).toContain('powershell.exe');
    expect(notifyArg).toContain('"-File"');
    expect(notifyArg).toContain('emdash-codex-notify.ps1');
    expect(notifyArg).not.toContain('"sh"');
    expect(fsWriteFileSyncMock).toHaveBeenCalledWith(
      expect.stringContaining('emdash-codex-notify.ps1'),
      expect.stringContaining('param([string]$payload)')
    );
    expect(fsMkdirSyncMock).toHaveBeenCalled();
  });

  it('uses an exact Codex thread target when one is stored', async () => {
    fsReadFileSyncMock.mockReturnValue(
      JSON.stringify({
        'codex-main-task123': {
          cwd: '/tmp/task',
          providerId: 'codex',
          resumeTarget: 'thread-123',
          strategy: 'codex-thread-id',
        },
      })
    );

    const { getStoredExactResumeArgs, _resetSessionMapForTest } = await import(
      '../../main/services/ptyManager'
    );
    _resetSessionMapForTest('/tmp/emdash-test/pty-session-map.json');

    expect(getStoredExactResumeArgs('codex', 'codex-main-task123', '/tmp/task')).toEqual([
      'resume',
      'thread-123',
    ]);
  });

  it('injects OPENCODE_CONFIG_DIR for local OpenCode PTYs', async () => {
    const { applyProviderRuntimeEnv } = await import('../../main/services/ptyManager');

    const env: Record<string, string> = {};
    applyProviderRuntimeEnv(env, {
      ptyId: 'opencode-main-task-123',
      providerId: 'opencode',
    });

    expect(env.OPENCODE_CONFIG_DIR).toBe(
      '/tmp/emdash-test/agent-hooks/opencode/opencode-main-task-123'
    );
    expect(fsMkdirSyncMock).toHaveBeenCalledWith(
      '/tmp/emdash-test/agent-hooks/opencode/opencode-main-task-123/plugins',
      { recursive: true }
    );
    expect(fsWriteFileSyncMock).toHaveBeenCalledWith(
      '/tmp/emdash-test/agent-hooks/opencode/opencode-main-task-123/plugins/emdash-notify.js',
      expect.stringContaining('session.idle')
    );
  });

  it('does not inject OPENCODE_CONFIG_DIR for non-OpenCode PTYs', async () => {
    const { applyProviderRuntimeEnv } = await import('../../main/services/ptyManager');

    const env: Record<string, string> = {};
    applyProviderRuntimeEnv(env, {
      ptyId: 'codex-main-task-shell',
      providerId: 'codex',
    });

    expect(env.OPENCODE_CONFIG_DIR).toBeUndefined();
    expect(fsWriteFileSyncMock).not.toHaveBeenCalled();
  });

  it('spawns tmux using its absolute path when tmux wrapping is enabled', async () => {
    const origPath = process.env.PATH;
    process.env.PATH = `/opt/homebrew/bin${origPath ? ':' + origPath : ''}`;

    fsStatSyncMock.mockImplementation((candidate: string) => {
      if (candidate === '/opt/homebrew/bin/tmux') {
        return { isFile: () => true };
      }
      throw new Error('ENOENT');
    });
    const mockProc = {
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
    };
    nodePtySpawnMock.mockReturnValue(mockProc);

    const { startPty, getTmuxSessionName } = await import('../../main/services/ptyManager');
    await startPty({
      id: 'claude-main-task-tmux',
      cwd: '/tmp/task',
      shell: '/bin/zsh',
      tmux: true,
    });

    process.env.PATH = origPath;

    expect(nodePtySpawnMock).toHaveBeenCalledWith(
      '/opt/homebrew/bin/tmux',
      ['new-session', '-As', getTmuxSessionName('claude-main-task-tmux'), '--', '/bin/zsh', '-il'],
      expect.objectContaining({
        cwd: '/tmp/task',
        env: expect.not.objectContaining({
          PATH: expect.anything(),
        }),
      })
    );
  });

  it('attaches PTY pipe error suppression on Windows only', async () => {
    const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    const onWin32 = vi.fn();
    const onDarwin = vi.fn();

    try {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      });

      nodePtySpawnMock.mockReturnValueOnce({
        on: onWin32,
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
        onData: vi.fn(),
        onExit: vi.fn(),
      });

      const { startPty } = await import('../../main/services/ptyManager');
      await startPty({
        id: 'codex-main-task-win32',
        cwd: '/tmp/task',
        shell: '/bin/zsh',
      });

      expect(onWin32).toHaveBeenCalledWith('error', expect.any(Function));

      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true,
      });

      nodePtySpawnMock.mockReturnValueOnce({
        on: onDarwin,
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
        onData: vi.fn(),
        onExit: vi.fn(),
      });

      await startPty({
        id: 'codex-main-task-darwin',
        cwd: '/tmp/task',
        shell: '/bin/zsh',
      });

      expect(onDarwin).not.toHaveBeenCalledWith('error', expect.any(Function));
    } finally {
      if (originalPlatformDescriptor) {
        Object.defineProperty(process, 'platform', originalPlatformDescriptor);
      }
    }
  });

  it('collects locale env vars for PTY environments', async () => {
    const originalLang = process.env.LANG;
    const originalLcAll = process.env.LC_ALL;
    const originalLcCtype = process.env.LC_CTYPE;

    process.env.LANG = 'en_US.UTF-8';
    process.env.LC_ALL = 'sr_RS.UTF-8';
    process.env.LC_CTYPE = 'sr_RS.UTF-8';

    try {
      const { getLocaleEnv } = await import('../../main/services/ptyManager');

      expect(getLocaleEnv()).toEqual({
        LANG: 'en_US.UTF-8',
        LC_ALL: 'sr_RS.UTF-8',
        LC_CTYPE: 'sr_RS.UTF-8',
      });
    } finally {
      restoreEnvVar('LANG', originalLang);
      restoreEnvVar('LC_ALL', originalLcAll);
      restoreEnvVar('LC_CTYPE', originalLcCtype);
    }
  });

  it('falls back to C.UTF-8 when PTY environments have no UTF-8 locale vars', async () => {
    const originalLang = process.env.LANG;
    const originalLcAll = process.env.LC_ALL;
    const originalLcCtype = process.env.LC_CTYPE;

    process.env.LANG = 'C';
    process.env.LC_ALL = 'POSIX';
    process.env.LC_CTYPE = 'C';

    try {
      const { getLocaleEnv } = await import('../../main/services/ptyManager');

      expect(getLocaleEnv()).toEqual({
        LANG: 'C.UTF-8',
        LC_CTYPE: 'C.UTF-8',
      });
    } finally {
      restoreEnvVar('LANG', originalLang);
      restoreEnvVar('LC_ALL', originalLcAll);
      restoreEnvVar('LC_CTYPE', originalLcCtype);
    }
  });

  it('preserves UTF-8 LANG without forcing LC_ALL fallback', async () => {
    const originalLang = process.env.LANG;
    const originalLcAll = process.env.LC_ALL;
    const originalLcCtype = process.env.LC_CTYPE;

    process.env.LANG = 'en_US.UTF-8';
    process.env.LC_ALL = 'C';
    delete process.env.LC_CTYPE;

    try {
      const { getLocaleEnv } = await import('../../main/services/ptyManager');

      expect(getLocaleEnv()).toEqual({
        LANG: 'en_US.UTF-8',
      });
    } finally {
      restoreEnvVar('LANG', originalLang);
      restoreEnvVar('LC_ALL', originalLcAll);
      restoreEnvVar('LC_CTYPE', originalLcCtype);
    }
  });

  it('strips inherited non-UTF-8 locale vars when composing PTY env', async () => {
    const { mergeEnvWithNormalizedLocale } = await import('../../main/services/ptyManager');

    expect(
      mergeEnvWithNormalizedLocale(
        {
          LANG: 'en_US.UTF-8',
          LC_ALL: 'C',
          LC_CTYPE: 'C',
          PATH: '/usr/bin',
        },
        {
          LC_ALL: 'POSIX',
          CUSTOM_FLAG: '1',
        }
      )
    ).toEqual({
      LANG: 'en_US.UTF-8',
      PATH: '/usr/bin',
      CUSTOM_FLAG: '1',
    });
  });

  it('decodes split UTF-8 chunks correctly in the lifecycle fallback forwarder', async () => {
    const { createUtf8StreamForwarder } = await import('../../main/services/ptyManager');
    const received: string[] = [];
    const forwarder = createUtf8StreamForwarder((data) => {
      received.push(data);
    });

    forwarder.pushStdout(Buffer.from('Marko Ran', 'utf8'));
    forwarder.pushStdout(Buffer.from([0xc4]));
    forwarder.pushStdout(Buffer.from([0x91, 0x65, 0x6c, 0x6f, 0x76, 0x69, 0xc4]));
    forwarder.pushStdout(Buffer.from([0x87]));
    forwarder.flush();

    expect(received.join('')).toBe('Marko Ranđelović');
  });

  it('waits for close before flushing UTF-8 fallback output and emitting exit', async () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = stdout;
    child.stderr = stderr;

    const { attachLifecycleSpawnFallbackHandlers } = await import('../../main/services/ptyManager');
    const received: string[] = [];
    const exits: Array<[number | null, string | null]> = [];
    const errors: Error[] = [];
    attachLifecycleSpawnFallbackHandlers(child, {
      onData: (data) => {
        received.push(data);
      },
      onExit: (code, signal) => {
        exits.push([code, signal]);
      },
      onError: (error) => {
        errors.push(error);
      },
    });

    stdout.emit('data', Buffer.from('Marko Ran', 'utf8'));
    stdout.emit('data', Buffer.from([0xc4]));
    child.emit('exit', 0, null);

    expect(received.join('')).toBe('Marko Ran');
    expect(exits).toEqual([]);
    expect(errors).toEqual([]);

    stdout.emit('data', Buffer.from([0x91]));
    child.emit('close', 0, null);

    expect(received.join('')).toBe('Marko Ranđ');
    expect(exits).toEqual([[0, null]]);
  });
});

describe('stale Claude session detection', () => {
  const SESSION_MAP_PATH = '/tmp/emdash-test/pty-session-map.json';
  const TEST_CWD = '/tmp/test-worktree';
  const TEST_UUID = 'test-uuid-00000000-0000-0000-0000';
  const PTY_ID = 'claude-main-task123';

  let applySessionIsolation: typeof import('../../main/services/ptyManager').applySessionIsolation;
  let resetSessionMap: typeof import('../../main/services/ptyManager')._resetSessionMapForTest;
  let claudeProvider: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    fsWriteFileSyncMock.mockImplementation(() => {});

    // Load module once (avoid vi.resetModules — dynamic require('electron') isn't
    // intercepted after module reset). Use _resetSessionMapForTest to clear
    // the in-memory cache between tests instead.
    const mod = await import('../../main/services/ptyManager');
    applySessionIsolation = mod.applySessionIsolation;
    resetSessionMap = mod._resetSessionMapForTest;
    resetSessionMap(SESSION_MAP_PATH);

    const { PROVIDERS } = await import('../../shared/providers/registry');
    claudeProvider = PROVIDERS.find((p) => p.id === 'claude')!;
  });

  it('resumes when session file exists and cwd matches', () => {
    const sessionMap = {
      [PTY_ID]: { uuid: TEST_UUID, cwd: TEST_CWD },
    };
    fsReadFileSyncMock.mockReturnValue(JSON.stringify(sessionMap));
    fsExistsSyncMock.mockImplementation((p: string) => {
      if (p.endsWith(`${TEST_UUID}.jsonl`)) return true;
      return false;
    });

    const cliArgs: string[] = [];
    const result = applySessionIsolation(cliArgs, claudeProvider, PTY_ID, TEST_CWD, true);

    expect(result).toBe(true);
    expect(cliArgs).toContain('--resume');
    expect(cliArgs).toContain(TEST_UUID);
  });

  it('does not resume when session file is missing', () => {
    const sessionMap = {
      [PTY_ID]: { uuid: TEST_UUID, cwd: TEST_CWD },
    };
    fsReadFileSyncMock.mockReturnValue(JSON.stringify(sessionMap));
    fsExistsSyncMock.mockReturnValue(false);

    const cliArgs: string[] = [];
    const result = applySessionIsolation(cliArgs, claudeProvider, PTY_ID, TEST_CWD, true);

    expect(result).toBe(false);
    expect(cliArgs).not.toContain('--resume');
    expect(cliArgs).not.toContain(TEST_UUID);
    // Stale entry must be evicted from the persisted session map
    expect(fsWriteFileSyncMock).toHaveBeenCalledWith(SESSION_MAP_PATH, JSON.stringify({}));
  });

  it('treats cwd mismatch as stale session', () => {
    const sessionMap = {
      [PTY_ID]: { uuid: TEST_UUID, cwd: '/tmp/old-worktree' },
    };
    fsReadFileSyncMock.mockReturnValue(JSON.stringify(sessionMap));
    // File may exist, but cwd mismatch should still be treated as stale
    fsExistsSyncMock.mockReturnValue(true);

    const cliArgs: string[] = [];
    const result = applySessionIsolation(cliArgs, claudeProvider, PTY_ID, TEST_CWD, true);

    expect(result).toBe(false);
    expect(cliArgs).not.toContain('--resume');
    expect(cliArgs).not.toContain(TEST_UUID);
    // Stale entry must be evicted from the persisted session map
    expect(fsWriteFileSyncMock).toHaveBeenCalledWith(SESSION_MAP_PATH, JSON.stringify({}));
  });
});
