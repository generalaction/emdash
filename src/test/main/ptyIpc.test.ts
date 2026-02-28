import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makePtyId } from '../../shared/ptyId';

type ExitPayload = {
  exitCode: number | null | undefined;
  signal: number | undefined;
};

type MockProc = {
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (payload: ExitPayload) => void) => void;
  write: ReturnType<typeof vi.fn>;
  emitExit: (exitCode: number | null | undefined, signal?: number) => void;
};

const ipcHandleHandlers = new Map<string, (...args: any[]) => any>();
const ipcOnHandlers = new Map<string, (...args: any[]) => any>();
const appListeners = new Map<string, Array<() => void>>();
const ptys = new Map<string, MockProc>();
const notificationCtor = vi.fn();
const notificationShow = vi.fn();
const telemetryCaptureMock = vi.fn();
let onDirectCliExitCallback: ((id: string, cwd: string) => void) | null = null;
let lastSshPtyStartOpts: any = null;

function createMockProc(): MockProc {
  const exitHandlers: Array<(payload: ExitPayload) => void> = [];
  return {
    onData: vi.fn(),
    onExit: (cb) => {
      exitHandlers.push(cb);
    },
    write: vi.fn(),
    emitExit: (exitCode, signal) => {
      for (const handler of exitHandlers) {
        handler({ exitCode, signal });
      }
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
  resolveProviderCommandConfig: resolveProviderCommandConfigMock,
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
  PROVIDER_IDS: ['codex', 'claude'],
  getProvider: vi.fn((id: string) => ({ name: id === 'codex' ? 'Codex' : 'Claude Code' })),
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
    expect(lastSshPtyStartOpts?.remoteInitCommand).toBeUndefined();

    const proc = ptys.get(id);
    expect(proc).toBeDefined();
    expect(proc!.write).toHaveBeenCalled();

    const written = (proc!.write as any).mock.calls.map((c: any[]) => c[0]).join('');
    expect(written).toContain("cd '/tmp/task'");
    expect(written).toContain('sh -c');
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
    expect(lastSshPtyStartOpts?.remoteInitCommand).toBeUndefined();

    const proc = ptys.get(id);
    expect(proc).toBeDefined();
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
    expect(lastSshPtyStartOpts?.remoteInitCommand).toBeUndefined();

    const proc = ptys.get(id);
    expect(proc).toBeDefined();
    expect(proc!.write).toHaveBeenCalled();
    const written = (proc!.write as any).mock.calls.map((c: any[]) => c[0]).join('');
    expect(written).toContain('command -v');
    expect(written).toContain('codex-remote;echo');
    expect(written).toContain("'\\''codex-remote;echo'\\''");
    expect(written).not.toContain('command -v codex-remote;echo');
  });
});
