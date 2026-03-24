import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePtyId } from '../../shared/ptyId';

type ExitPayload = {
  exitCode: number | null | undefined;
  signal: number | undefined;
};

type MockProc = {
  onData: (cb: (data: string) => void) => { dispose: () => void };
  onExit: (cb: (payload: ExitPayload) => void) => void;
  write: ReturnType<typeof vi.fn>;
  emitExit: (exitCode: number | null | undefined, signal?: number) => void;
  emitData: (data: string) => void;
};

const ipcHandleHandlers = new Map<string, (...args: any[]) => any>();
const ipcOnHandlers = new Map<string, (...args: any[]) => any>();
const appListeners = new Map<string, Array<() => void>>();
const ptys = new Map<string, MockProc>();
const notificationCtor = vi.fn();
const awaitSetupMock = vi.fn(async (_taskId: string) => {});
const notificationShow = vi.fn();
const telemetryCaptureMock = vi.fn();
const agentEventGetPortMock = vi.fn(() => 12345);
const agentEventGetTokenMock = vi.fn(() => 'test-hook-token');
const openCodeGetRemoteConfigDirMock = vi.fn(
  (ptyId: string) => `$HOME/.config/emdash/agent-hooks/opencode/${ptyId}`
);
const openCodeGetPluginSourceMock = vi.fn(
  () => 'export const EmdashNotifyPlugin = async () => ({ event: async () => {} });\n'
);
const clearStoredSessionMock = vi.fn();
const getStoredResumeTargetMock = vi.fn(() => null);
const markCodexSessionBoundMock = vi.fn();
const codexThreadExistsForCwdMock = vi.fn(async () => true);
const codexFindLatestRecentThreadForCwdMock = vi.fn(async () => null);
const codexFindLatestThreadForCwdMock = vi.fn(async () => null);
const execFileMock = vi.fn(
  (
    _cmd: string,
    _args: string[],
    _opts: any,
    cb: (err: any, stdout: string, stderr: string) => void
  ) => {
    cb(null, '', '');
  }
);
let onDirectCliExitCallback: ((id: string, cwd: string) => void) | null = null;
let lastSshPtyStartOpts: any = null;

function createMockProc(): MockProc {
  const exitHandlers: Array<(payload: ExitPayload) => void> = [];
  const dataHandlers: Array<(data: string) => void> = [];
  return {
    onData: vi.fn((cb: (data: string) => void) => {
      dataHandlers.push(cb);
      return {
        dispose: () => {
          const idx = dataHandlers.indexOf(cb);
          if (idx >= 0) dataHandlers.splice(idx, 1);
        },
      };
    }),
    onExit: (cb) => {
      exitHandlers.push(cb);
    },
    write: vi.fn(),
    emitExit: (exitCode, signal) => {
      for (const handler of exitHandlers) {
        handler({ exitCode, signal });
      }
    },
    emitData: (data: string) => {
      for (const handler of [...dataHandlers]) handler(data);
    },
  };
}

const startPtyMock = vi.fn(async ({ id }: { id: string }) => {
  const proc = createMockProc();
  ptys.set(id, proc);
  return proc;
});
const startDirectPtyMock = vi.fn(({ id, cwd }: { id: string; cwd: string }) => {
  const proc = createMockProc();
  ptys.set(id, proc);
  // Mimic ptyManager wiring: direct CLI exit triggers shell respawn callback first.
  proc.onExit(() => {
    onDirectCliExitCallback?.(id, cwd);
  });
  return proc;
});
const startSshPtyMock = vi.fn((opts: any) => {
  const { id } = opts as { id: string };
  lastSshPtyStartOpts = opts;
  const proc = createMockProc();
  ptys.set(id, proc);
  return proc;
});
const parseShellArgsMock = vi.fn((input: string) => input.trim().split(/\s+/).filter(Boolean));
const buildProviderCliArgsMock = vi.fn((opts: any) => {
  const args: string[] = [];
  if (opts.resume && opts.resumeFlag) args.push(...parseShellArgsMock(opts.resumeFlag));
  if (opts.defaultArgs?.length) args.push(...opts.defaultArgs);
  if (opts.autoApprove && opts.autoApproveFlag)
    args.push(...parseShellArgsMock(opts.autoApproveFlag));
  if (
    opts.initialPromptFlag !== undefined &&
    !opts.useKeystrokeInjection &&
    opts.initialPrompt?.trim()
  ) {
    if (opts.initialPromptFlag) args.push(...parseShellArgsMock(opts.initialPromptFlag));
    args.push(opts.initialPrompt.trim());
  }
  return args;
});
const getProviderRuntimeCliArgsMock = vi.fn((opts: any) => {
  if (opts.providerId !== 'codex' || agentEventGetPortMock() <= 0) {
    return [];
  }
  return ['-c', 'notify=["sh","-lc","mock-codex-notify","sh"]'];
});
const resolveProviderCommandConfigMock = vi.fn();
const getPtyMock = vi.fn((id: string) => ptys.get(id));
const writePtyMock = vi.fn((id: string, data: string) => {
  ptys.get(id)?.write(data);
});
const killPtyMock = vi.fn((id: string) => {
  ptys.delete(id);
});
const removePtyRecordMock = vi.fn((id: string) => {
  ptys.delete(id);
});
const getAllWindowsMock = vi.fn(() => [
  {
    isFocused: () => false,
    webContents: { isDestroyed: () => false, send: vi.fn() },
  },
]);

vi.mock('electron', () => {
  class MockNotification {
    static isSupported = vi.fn(() => true);

    constructor(options: unknown) {
      notificationCtor(options);
    }

    show() {
      notificationShow();
    }
  }

  return {
    app: {
      on: vi.fn((event: string, cb: () => void) => {
        const list = appListeners.get(event) || [];
        list.push(cb);
        appListeners.set(event, list);
      }),
    },
    ipcMain: {
      handle: vi.fn((channel: string, cb: (...args: any[]) => any) => {
        ipcHandleHandlers.set(channel, cb);
      }),
      on: vi.fn((channel: string, cb: (...args: any[]) => any) => {
        ipcOnHandlers.set(channel, cb);
      }),
    },
    BrowserWindow: {
      getAllWindows: getAllWindowsMock,
    },
    Notification: MockNotification,
  };
});

vi.mock('../../main/services/ptyManager', () => ({
  startPty: startPtyMock,
  writePty: writePtyMock,
  resizePty: vi.fn(),
  killPty: killPtyMock,
  getPty: getPtyMock,
  getPtyKind: vi.fn(() => 'local'),
  startDirectPty: startDirectPtyMock,
  startSshPty: startSshPtyMock,
  removePtyRecord: removePtyRecordMock,
  setOnDirectCliExit: vi.fn((cb: (id: string, cwd: string) => void) => {
    onDirectCliExitCallback = cb;
  }),
  parseShellArgs: parseShellArgsMock,
  buildProviderCliArgs: buildProviderCliArgsMock,
  getProviderRuntimeCliArgs: getProviderRuntimeCliArgsMock,
  resolveProviderCommandConfig: resolveProviderCommandConfigMock,
  killTmuxSession: vi.fn(),
  getTmuxSessionName: vi.fn(() => ''),
  getPtyTmuxSessionName: vi.fn(() => ''),
  clearStoredSession: clearStoredSessionMock,
  getStoredResumeTarget: getStoredResumeTargetMock,
  markCodexSessionBound: markCodexSessionBoundMock,
}));

vi.mock('../../main/lib/logger', () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../main/settings', () => ({
  getAppSettings: vi.fn(() => ({
    notifications: { enabled: true, sound: true },
  })),
}));

vi.mock('../../main/telemetry', () => ({
  capture: telemetryCaptureMock,
}));

vi.mock('../../shared/providers/registry', () => ({
  PROVIDER_IDS: ['codex', 'claude', 'opencode'],
  getProvider: vi.fn((id: string) => ({
    name: id === 'codex' ? 'Codex' : id === 'opencode' ? 'OpenCode' : 'Claude Code',
  })),
}));

vi.mock('../../main/errorTracking', () => ({
  errorTracking: {
    captureAgentSpawnError: vi.fn(),
  },
}));

vi.mock('../../main/services/TerminalSnapshotService', () => ({
  terminalSnapshotService: {
    getSnapshot: vi.fn(),
    saveSnapshot: vi.fn(),
    deleteSnapshot: vi.fn(),
  },
}));

vi.mock('../../main/services/TerminalConfigParser', () => ({
  detectAndLoadTerminalConfig: vi.fn(),
}));

vi.mock('../../main/services/DatabaseService', () => ({
  databaseService: {},
}));

vi.mock('../../main/services/ClaudeConfigService', () => ({
  maybeAutoTrustForClaude: vi.fn(),
}));

vi.mock('../../main/services/AgentEventService', () => ({
  agentEventService: {
    getPort: agentEventGetPortMock,
    getToken: agentEventGetTokenMock,
  },
}));

vi.mock('../../main/services/CodexSessionService', () => ({
  codexSessionService: {
    threadExistsForCwd: codexThreadExistsForCwdMock,
    findLatestRecentThreadForCwd: codexFindLatestRecentThreadForCwdMock,
    findLatestThreadForCwd: codexFindLatestThreadForCwdMock,
  },
}));

vi.mock('../../main/services/ClaudeHookService', () => ({
  ClaudeHookService: {
    writeHookConfig: vi.fn(),
    makeHookCommand: vi.fn((type: string) => `mock-hook-command-${type}`),
    mergeHookEntries: vi.fn((existing: Record<string, any>) => {
      existing.hooks = {
        Notification: [{ hooks: [{ type: 'command', command: 'mock-hook-command-notification' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'mock-hook-command-stop' }] }],
      };
      return existing;
    }),
  },
}));

vi.mock('../../main/services/OpenCodeHookService', () => ({
  OPEN_CODE_PLUGIN_FILE: 'emdash-notify.js',
  OpenCodeHookService: {
    getRemoteConfigDir: openCodeGetRemoteConfigDirMock,
    getPluginSource: openCodeGetPluginSourceMock,
  },
}));

vi.mock('../../main/services/LifecycleScriptsService', () => ({
  lifecycleScriptsService: {
    getShellSetup: vi.fn(() => undefined),
    getTmuxEnabled: vi.fn(() => false),
  },
}));

vi.mock('../../main/services/TaskLifecycleService', () => ({
  taskLifecycleService: {
    awaitSetup: (taskId: string) => awaitSetupMock(taskId),
  },
}));

vi.mock('child_process', () => ({
  execFile: execFileMock,
}));

describe('ptyIpc notification lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    ipcHandleHandlers.clear();
    ipcOnHandlers.clear();
    appListeners.clear();
    ptys.clear();
    onDirectCliExitCallback = null;
    lastSshPtyStartOpts = null;
    resolveProviderCommandConfigMock.mockReturnValue(null);
    getProviderRuntimeCliArgsMock.mockClear();
    getStoredResumeTargetMock.mockReturnValue(null);
    codexThreadExistsForCwdMock.mockResolvedValue(true);
    codexFindLatestRecentThreadForCwdMock.mockResolvedValue(null);
    codexFindLatestThreadForCwdMock.mockResolvedValue(null);
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await vi.runAllTimersAsync();
    vi.useRealTimers();
  });

  function createSender() {
    return {
      id: 1,
      send: vi.fn(),
      isDestroyed: vi.fn(() => false),
      once: vi.fn(),
    };
  }

  it('does not show completion notification after app quit cleanup even if exit 0 arrives', async () => {
    const { registerPtyIpc } = await import('../../main/services/ptyIpc');
    registerPtyIpc();

    const start = ipcHandleHandlers.get('pty:start');
    expect(start).toBeTypeOf('function');

    const id = makePtyId('codex', 'main', 'task-quit');
    await start!(
      { sender: createSender() },
      { id, cwd: '/tmp/task', shell: 'codex', cols: 120, rows: 32 }
    );

    const proc = ptys.get(id);
    expect(proc).toBeDefined();

    const beforeQuit = appListeners.get('before-quit')?.[0];
    expect(beforeQuit).toBeTypeOf('function');
    beforeQuit!();

    // Simulate late onExit callback firing after cleanup kill.
    proc!.emitExit(0, undefined);

    expect(notificationCtor).not.toHaveBeenCalled();
    expect(notificationShow).not.toHaveBeenCalled();
  });

  it('injects remote init commands so provider lookup uses login shell PATH', async () => {
    const { registerPtyIpc } = await import('../../main/services/ptyIpc');
    registerPtyIpc();

    const startDirect = ipcHandleHandlers.get('pty:startDirect');
    expect(startDirect).toBeTypeOf('function');

    const id = makePtyId('claude', 'main', 'task-remote');
    await startDirect!(
      { sender: createSender() },
      {
        id,
        providerId: 'claude',
        cwd: '/tmp/task',
        remote: { connectionId: 'ssh-config:remote-alias' },
        cols: 120,
        rows: 32,
      }
    );

    expect(startSshPtyMock).toHaveBeenCalledTimes(1);
    expect(lastSshPtyStartOpts?.target).toBe('remote-alias');
    expect(lastSshPtyStartOpts?.remoteInitCommand).toContain('/bin/sh -c');
    expect(lastSshPtyStartOpts?.remoteInitCommand).toMatch(/cd\b.*\/tmp\/task/);
    expect(lastSshPtyStartOpts?.remoteInitCommand).toContain('exec');

    const proc = ptys.get(id);
    expect(proc).toBeDefined();

    proc!.emitData('user@host:~$ ');

    expect(proc!.write).toHaveBeenCalled();

    const written = (proc!.write as any).mock.calls.map((c: any[]) => c[0]).join('');
    expect(written).toContain('sh -ilc');
    expect(written).toContain('command -v');
    expect(written).toContain('claude');
  });

  it('does not show completion notification on process exit (moved to AgentEventService)', async () => {
    const { registerPtyIpc } = await import('../../main/services/ptyIpc');
    registerPtyIpc();

    const start = ipcHandleHandlers.get('pty:start');
    expect(start).toBeTypeOf('function');

    const id = makePtyId('codex', 'main', 'task-success');
    await start!(
      { sender: createSender() },
      { id, cwd: '/tmp/task', shell: 'codex', cols: 120, rows: 32 }
    );

    const proc = ptys.get(id);
    expect(proc).toBeDefined();

    proc!.emitExit(0, undefined);

    // OS notifications are now driven by hook events in AgentEventService, not PTY exit
    expect(notificationCtor).not.toHaveBeenCalled();
    expect(notificationShow).not.toHaveBeenCalled();
  });

  it('forwards non-ASCII PTY data to the renderer unchanged', async () => {
    const { registerPtyIpc } = await import('../../main/services/ptyIpc');
    registerPtyIpc();

    const start = ipcHandleHandlers.get('pty:start');
    expect(start).toBeTypeOf('function');

    const id = makePtyId('codex', 'main', 'task-unicode');
    const sender = createSender();
    await start!({ sender }, { id, cwd: '/tmp/task', shell: 'codex', cols: 120, rows: 32 });

    const proc = ptys.get(id);
    expect(proc).toBeDefined();

    proc!.emitData('Marko Ranđelović');
    await vi.runAllTimersAsync();

    expect(sender.send).toHaveBeenCalledWith(`pty:data:${id}`, 'Marko Ranđelović');
  });

  it('keeps replacement PTY writable after direct CLI exit triggers shell respawn', async () => {
    const { registerPtyIpc } = await import('../../main/services/ptyIpc');
    registerPtyIpc();

    const startDirect = ipcHandleHandlers.get('pty:startDirect');
    const ptyInput = ipcOnHandlers.get('pty:input');
    expect(startDirect).toBeTypeOf('function');
    expect(ptyInput).toBeTypeOf('function');

    const id = makePtyId('codex', 'main', 'task-respawn');
    const sender = createSender();
    const result = await startDirect!(
      { sender },
      { id, providerId: 'codex', cwd: '/tmp/task', cols: 120, rows: 32, resume: true }
    );
    expect(result?.ok).toBe(true);

    const directProc = ptys.get(id);
    expect(directProc).toBeDefined();

    directProc!.emitExit(130, undefined);

    // Shell respawn replaced the old PTY record; stale cleanup must not delete it.
    const replacementProc = ptys.get(id);
    expect(replacementProc).toBeDefined();
    expect(replacementProc).not.toBe(directProc);
    expect(telemetryCaptureMock).toHaveBeenCalledWith(
      'agent_run_finish',
      expect.objectContaining({ provider: 'codex' })
    );

    ptyInput!({}, { id, data: 'codex resume --last\r' });
    expect(replacementProc!.write).toHaveBeenCalledWith('codex resume --last\r');
  });

  it('still cleans up direct PTY exit when no replacement PTY exists', async () => {
    const { registerPtyIpc } = await import('../../main/services/ptyIpc');
    registerPtyIpc();

    const startDirect = ipcHandleHandlers.get('pty:startDirect');
    expect(startDirect).toBeTypeOf('function');

    const id = makePtyId('codex', 'main', 'task-no-replacement');
    const sender = createSender();
    const result = await startDirect!(
      { sender },
      { id, providerId: 'codex', cwd: '/tmp/task', cols: 120, rows: 32, resume: true }
    );
    expect(result?.ok).toBe(true);

    const directProc = ptys.get(id);
    expect(directProc).toBeDefined();

    // Simulate respawn callback unavailable/failing to replace.
    onDirectCliExitCallback = null;
    directProc!.emitExit(130, undefined);

    expect(telemetryCaptureMock).toHaveBeenCalledWith(
      'agent_run_finish',
      expect.objectContaining({ provider: 'codex' })
    );
    expect(removePtyRecordMock).toHaveBeenCalledWith(id);
    expect(ptys.has(id)).toBe(false);
  });

  it('prunes stale exact Codex resume targets before local restart', async () => {
    getStoredResumeTargetMock.mockReturnValue('thread-stale' as any);
    codexThreadExistsForCwdMock.mockResolvedValue(false);

    const { registerPtyIpc } = await import('../../main/services/ptyIpc');
    registerPtyIpc();

    const startDirect = ipcHandleHandlers.get('pty:startDirect');
    expect(startDirect).toBeTypeOf('function');

    const id = makePtyId('codex', 'main', 'task-stale-target');
    const result = await startDirect!(
      { sender: createSender() },
      { id, providerId: 'codex', cwd: '/tmp/task', cols: 120, rows: 32, resume: true }
    );

    expect(result?.ok).toBe(true);
    expect(codexThreadExistsForCwdMock).toHaveBeenCalledWith('thread-stale', '/tmp/task');
    expect(clearStoredSessionMock).toHaveBeenCalledWith(id);
  });

  it('binds a newly started Codex PTY to an exact thread id', async () => {
    codexFindLatestRecentThreadForCwdMock.mockResolvedValue({
      id: 'thread-123',
      cwd: '/tmp/task',
      createdAt: 1,
      updatedAt: 1,
      archived: false,
    } as any);

    const { registerPtyIpc } = await import('../../main/services/ptyIpc');
    registerPtyIpc();

    const startDirect = ipcHandleHandlers.get('pty:startDirect');
    expect(startDirect).toBeTypeOf('function');

    const id = makePtyId('codex', 'main', 'task-bind-target');
    const result = await startDirect!(
      { sender: createSender() },
      { id, providerId: 'codex', cwd: '/tmp/task', cols: 120, rows: 32 }
    );

    expect(result?.ok).toBe(true);
    await vi.runAllTimersAsync();

    expect(codexFindLatestRecentThreadForCwdMock).toHaveBeenCalled();
    expect(markCodexSessionBoundMock).toHaveBeenCalledWith(id, 'thread-123', '/tmp/task');
  });

  it('binds immediately to an existing exact-cwd Codex thread before polling', async () => {
    codexFindLatestThreadForCwdMock.mockResolvedValue({
      id: 'thread-existing',
      cwd: '/tmp/task',
      createdAt: 1,
      updatedAt: 2,
      archived: false,
    } as any);

    const { registerPtyIpc } = await import('../../main/services/ptyIpc');
    registerPtyIpc();

    const startDirect = ipcHandleHandlers.get('pty:startDirect');
    expect(startDirect).toBeTypeOf('function');

    const id = makePtyId('codex', 'main', 'task-existing-thread');
    const result = await startDirect!(
      { sender: createSender() },
      { id, providerId: 'codex', cwd: '/tmp/task', cols: 120, rows: 32 }
    );

    expect(result?.ok).toBe(true);
    await vi.runAllTimersAsync();

    expect(codexFindLatestThreadForCwdMock).toHaveBeenCalledWith('/tmp/task');
    expect(codexFindLatestRecentThreadForCwdMock).not.toHaveBeenCalled();
    expect(markCodexSessionBoundMock).toHaveBeenCalledWith(id, 'thread-existing', '/tmp/task');
  });

  it('uses resolved provider config for remote invocation flags', async () => {
    resolveProviderCommandConfigMock.mockReturnValue({
      provider: {
        id: 'codex',
        name: 'Codex',
        installCommand: 'npm install -g @openai/codex',
        useKeystrokeInjection: false,
      },
      cli: 'codex-remote',
      resumeFlag: 'resume --last',
      defaultArgs: ['--model', 'gpt-5'],
      autoApproveFlag: '--dangerously-bypass-approvals-and-sandbox',
      initialPromptFlag: '',
    });

    const { registerPtyIpc } = await import('../../main/services/ptyIpc');
    registerPtyIpc();

    const startDirect = ipcHandleHandlers.get('pty:startDirect');
    expect(startDirect).toBeTypeOf('function');

    const id = makePtyId('codex', 'main', 'task-remote-custom');
    const sender = createSender();
    const result = await startDirect!(
      { sender },
      {
        id,
        providerId: 'codex',
        cwd: '/tmp/task',
        remote: { connectionId: 'ssh-config:devbox' },
        autoApprove: true,
        initialPrompt: 'hello world',
        resume: true,
      }
    );

    expect(result?.ok).toBe(true);
    expect(buildProviderCliArgsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeFlag: 'resume --last',
        autoApproveFlag: '--dangerously-bypass-approvals-and-sandbox',
      })
    );
    expect(startSshPtyMock).toHaveBeenCalledTimes(1);
    expect(lastSshPtyStartOpts?.remoteInitCommand).toContain('/bin/sh -c');
    expect(lastSshPtyStartOpts?.remoteInitCommand).toMatch(/cd\b.*\/tmp\/task/);

    const proc = ptys.get(id);
    expect(proc).toBeDefined();

    proc!.emitData('user@host:~$ ');

    expect(proc!.write).toHaveBeenCalled();
    const written = (proc!.write as any).mock.calls.map((c: any[]) => c[0]).join('');
    expect(written).toContain('command -v');
    expect(written).toContain('codex-remote');
    expect(written).toContain('resume');
    expect(written).toContain('--last');
    expect(written).toContain('--model');
    expect(written).toContain('gpt-5');
    expect(written).toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(written).toContain('hello world');
  });

  it('quotes remote custom CLI tokens to prevent shell metachar expansion', async () => {
    resolveProviderCommandConfigMock.mockReturnValue({
      provider: { installCommand: undefined, useKeystrokeInjection: false },
      cli: 'codex-remote;echo',
      resumeFlag: 'resume --last',
      defaultArgs: [],
      autoApproveFlag: '--dangerously-bypass-approvals-and-sandbox',
      initialPromptFlag: '',
    });

    const { registerPtyIpc } = await import('../../main/services/ptyIpc');
    registerPtyIpc();

    const startDirect = ipcHandleHandlers.get('pty:startDirect');
    expect(startDirect).toBeTypeOf('function');

    const id = makePtyId('codex', 'main', 'task-remote-metachar');
    const sender = createSender();
    const result = await startDirect!(
      { sender },
      {
        id,
        providerId: 'codex',
        cwd: '/tmp/task',
        remote: { connectionId: 'ssh-config:devbox' },
      }
    );

    expect(result?.ok).toBe(true);
    expect(lastSshPtyStartOpts?.remoteInitCommand).toContain('/bin/sh -c');
    expect(lastSshPtyStartOpts?.remoteInitCommand).toMatch(/cd\b.*\/tmp\/task/);

    const proc = ptys.get(id);
    expect(proc).toBeDefined();

    proc!.emitData('user@host:~$ ');

    expect(proc!.write).toHaveBeenCalled();
    const written = (proc!.write as any).mock.calls.map((c: any[]) => c[0]).join('');
    expect(written).toContain('command -v');
    expect(written).toContain('codex-remote;echo');
    expect(written).toContain("'\\''codex-remote;echo'\\''");
    expect(written).not.toContain('command -v codex-remote;echo');
  });

  it('adds reverse SSH tunnel and hook env for remote pty:startDirect', async () => {
    agentEventGetPortMock.mockReturnValue(12345);
    agentEventGetTokenMock.mockReturnValue('test-hook-token');

    const { registerPtyIpc } = await import('../../main/services/ptyIpc');
    registerPtyIpc();

    const startDirect = ipcHandleHandlers.get('pty:startDirect');
    expect(startDirect).toBeTypeOf('function');

    const id = makePtyId('codex', 'main', 'task-remote-hook');
    const result = await startDirect!(
      { sender: createSender() },
      {
        id,
        providerId: 'codex',
        cwd: '/tmp/task',
        remote: { connectionId: 'ssh-config:remote-alias' },
        cols: 120,
        rows: 32,
      }
    );

    expect(result?.ok).toBe(true);

    // SSH args should contain reverse tunnel flag
    const sshArgs: string[] = lastSshPtyStartOpts?.sshArgs ?? [];
    const dashRIndex = sshArgs.indexOf('-R');
    expect(dashRIndex).toBeGreaterThanOrEqual(0);
    const tunnelSpec = sshArgs[dashRIndex + 1];
    expect(tunnelSpec).toMatch(/^127\.0\.0\.1:\d+:127\.0\.0\.1:12345$/);

    // Init keystrokes should contain hook env var exports
    const proc = ptys.get(id);
    expect(proc).toBeDefined();

    proc!.emitData('user@host:~$ ');

    const written = (proc!.write as any).mock.calls.map((c: any[]) => c[0]).join('');
    expect(written).toContain('export EMDASH_HOOK_PORT=');
    expect(written).toContain('export EMDASH_HOOK_TOKEN=');
    expect(written).toContain('export EMDASH_PTY_ID=');
    expect(written).toContain('test-hook-token');
    expect(written).toContain('notify=["sh","-lc","mock-codex-notify","sh"]');
  });

  it('does not add reverse tunnel when hook port is 0', async () => {
    agentEventGetPortMock.mockReturnValue(0);

    const { registerPtyIpc } = await import('../../main/services/ptyIpc');
    registerPtyIpc();

    const startDirect = ipcHandleHandlers.get('pty:startDirect');
    expect(startDirect).toBeTypeOf('function');

    const id = makePtyId('codex', 'main', 'task-remote-no-hook');
    const result = await startDirect!(
      { sender: createSender() },
      {
        id,
        providerId: 'codex',
        cwd: '/tmp/task',
        remote: { connectionId: 'ssh-config:remote-alias' },
        cols: 120,
        rows: 32,
      }
    );

    expect(result?.ok).toBe(true);

    const sshArgs: string[] = lastSshPtyStartOpts?.sshArgs ?? [];
    expect(sshArgs).not.toContain('-R');

    // No hook env in keystrokes
    const proc = ptys.get(id);
    expect(proc).toBeDefined();

    proc!.emitData('user@host:~$ ');

    const written = (proc!.write as any).mock.calls.map((c: any[]) => c[0]).join('');
    expect(written).not.toContain('EMDASH_HOOK_PORT=');
    expect(written).not.toContain('mock-codex-notify');
  });

  it('writes OpenCode plugin on remote and exports OPENCODE_CONFIG_DIR', async () => {
    agentEventGetPortMock.mockReturnValue(12345);

    const { registerPtyIpc } = await import('../../main/services/ptyIpc');
    registerPtyIpc();

    const startDirect = ipcHandleHandlers.get('pty:startDirect');
    expect(startDirect).toBeTypeOf('function');

    const id = makePtyId('opencode', 'main', 'task-remote-opencode-hook');
    const result = await startDirect!(
      { sender: createSender() },
      {
        id,
        providerId: 'opencode',
        cwd: '/tmp/task',
        remote: { connectionId: 'ssh-config:remote-alias' },
        cols: 120,
        rows: 32,
      }
    );

    expect(result?.ok).toBe(true);
    expect(openCodeGetRemoteConfigDirMock).toHaveBeenCalledWith(id);
    expect(openCodeGetPluginSourceMock).toHaveBeenCalled();

    const pluginWriteCall = execFileMock.mock.calls.find(
      (c: any[]) =>
        c[0] === 'ssh' &&
        typeof c[1]?.[c[1].length - 1] === 'string' &&
        c[1][c[1].length - 1].includes('emdash-notify.js')
    );
    expect(pluginWriteCall).toBeDefined();

    const proc = ptys.get(id);
    expect(proc).toBeDefined();

    proc!.emitData('user@host:~$ ');

    const written = (proc!.write as any).mock.calls.map((c: any[]) => c[0]).join('');
    expect(written).toContain('export OPENCODE_CONFIG_DIR=');
    expect(written).toContain(`$HOME/.config/emdash/agent-hooks/opencode/${id}`);
  });

  it('writes Claude hook config on remote via ssh exec for claude provider', async () => {
    agentEventGetPortMock.mockReturnValue(12345);
    agentEventGetTokenMock.mockReturnValue('test-hook-token');

    const { registerPtyIpc } = await import('../../main/services/ptyIpc');
    registerPtyIpc();

    const startDirect = ipcHandleHandlers.get('pty:startDirect');
    expect(startDirect).toBeTypeOf('function');

    const id = makePtyId('claude', 'main', 'task-remote-claude-hook');
    const result = await startDirect!(
      { sender: createSender() },
      {
        id,
        providerId: 'claude',
        cwd: '/home/user/project',
        remote: { connectionId: 'ssh-config:remote-alias' },
        cols: 120,
        rows: 32,
      }
    );

    expect(result?.ok).toBe(true);

    // Hook config is written via ssh exec (execFile), not PTY keystrokes
    const sshExecCalls = execFileMock.mock.calls.filter(
      (c: any[]) => c[0] === 'ssh' && typeof c[1]?.[c[1].length - 1] === 'string'
    );
    const hookConfigCall = sshExecCalls.find((c: any[]) => {
      const cmd = c[1][c[1].length - 1];
      return cmd.includes('settings.local.json') && cmd.includes('mkdir -p');
    });
    expect(hookConfigCall).toBeDefined();

    // PTY keystrokes should NOT contain the hook config (it went via ssh exec)
    const proc = ptys.get(id);
    expect(proc).toBeDefined();
    const written = (proc!.write as any).mock.calls.map((c: any[]) => c[0]).join('');
    expect(written).not.toContain('settings.local.json');
  });

  it('does not write hook config on remote for non-claude provider', async () => {
    agentEventGetPortMock.mockReturnValue(12345);
    agentEventGetTokenMock.mockReturnValue('test-hook-token');

    const { registerPtyIpc } = await import('../../main/services/ptyIpc');
    registerPtyIpc();

    const startDirect = ipcHandleHandlers.get('pty:startDirect');
    expect(startDirect).toBeTypeOf('function');

    const id = makePtyId('codex', 'main', 'task-remote-codex-no-hook-config');
    const result = await startDirect!(
      { sender: createSender() },
      {
        id,
        providerId: 'codex',
        cwd: '/tmp/task',
        remote: { connectionId: 'ssh-config:remote-alias' },
        cols: 120,
        rows: 32,
      }
    );

    expect(result?.ok).toBe(true);

    // No ssh exec call for hook config
    const hookConfigCalls = execFileMock.mock.calls.filter(
      (c: any[]) =>
        c[0] === 'ssh' &&
        typeof c[1]?.[c[1].length - 1] === 'string' &&
        c[1][c[1].length - 1].includes('settings.local.json')
    );
    expect(hookConfigCalls).toHaveLength(0);
  });

  it('pty:startDirect waits for in-flight setup before spawning agent PTY', async () => {
    let resolveSetup!: () => void;
    const setupGate = new Promise<void>((resolve) => {
      resolveSetup = resolve;
    });
    awaitSetupMock.mockReturnValueOnce(setupGate);

    const { registerPtyIpc } = await import('../../main/services/ptyIpc');
    registerPtyIpc();

    const startDirect = ipcHandleHandlers.get('pty:startDirect');
    expect(startDirect).toBeTypeOf('function');

    const id = makePtyId('claude', 'main', 'task-setup-gate-direct');
    const handlerPromise = startDirect!(
      { sender: createSender() },
      { id, providerId: 'claude', cwd: '/tmp/task', cols: 120, rows: 32 }
    );

    // Setup is still pending — PTY must not be spawned yet
    expect(startDirectPtyMock).not.toHaveBeenCalled();
    expect(startPtyMock).not.toHaveBeenCalled();

    // Unblock setup and wait for the handler to finish
    resolveSetup();
    await handlerPromise;

    // PTY should now be spawned
    expect(startDirectPtyMock).toHaveBeenCalledOnce();
  });

  it('pty:start waits for in-flight setup before spawning shell PTY', async () => {
    let resolveSetup!: () => void;
    const setupGate = new Promise<void>((resolve) => {
      resolveSetup = resolve;
    });
    awaitSetupMock.mockReturnValueOnce(setupGate);

    const { registerPtyIpc } = await import('../../main/services/ptyIpc');
    registerPtyIpc();

    const start = ipcHandleHandlers.get('pty:start');
    expect(start).toBeTypeOf('function');

    const id = makePtyId('codex', 'main', 'task-setup-gate-shell');
    const handlerPromise = start!(
      { sender: createSender() },
      { id, cwd: '/tmp/task', shell: 'codex', cols: 120, rows: 32 }
    );

    // Setup is still pending — PTY must not be spawned yet
    expect(startPtyMock).not.toHaveBeenCalled();

    // Unblock setup and wait for the handler to finish
    resolveSetup();
    await handlerPromise;

    // PTY should now be spawned
    expect(startPtyMock).toHaveBeenCalledOnce();
  });
});
