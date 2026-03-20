import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Mock child type
// ---------------------------------------------------------------------------
type MockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid: number;
  exitCode: number | null;
  killed: boolean;
  kill: (signal?: NodeJS.Signals) => boolean;
};

function createChild(pid = 1234): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  });
  return child;
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const spawnMock = vi.fn();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn().mockReturnValue([]),
  },
}));

vi.mock('node:child_process', () => ({
  spawn: (...args: any[]) => spawnMock(...args),
}));

vi.mock('../../main/lib/logger', () => ({
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// In-memory DB mock
const insertMock = vi.fn();
const updateMock = vi.fn();
const selectMock = vi.fn();
const deleteMock = vi.fn();

const mockDb = {
  insert: () => ({
    values: (vals: any) => {
      insertMock(vals);
      return { onConflictDoUpdate: () => ({ returning: () => [vals] }), returning: () => [vals] };
    },
  }),
  update: () => ({
    set: (vals: any) => {
      updateMock(vals);
      return { where: () => Promise.resolve() };
    },
  }),
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => {
          const rows = selectMock();
          return Promise.resolve(rows ?? []);
        },
      }),
    }),
  }),
  delete: () => ({
    where: () => {
      deleteMock();
      return Promise.resolve();
    },
  }),
};

vi.mock('../../main/db/drizzleClient', () => ({
  getDrizzleClient: () => Promise.resolve({ db: mockDb }),
}));

const sshConnectMock = vi.fn().mockResolvedValue('conn-id');
const sshIsConnectedMock = vi.fn().mockReturnValue(false);

vi.mock('../../main/services/ssh/SshService', () => ({
  sshService: {
    connect: (...args: any[]) => sshConnectMock(...args),
    isConnected: (...args: any[]) => sshIsConnectedMock(...args),
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('WorkspaceProviderService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // provision()
  // -------------------------------------------------------------------------
  describe('provision', () => {
    it('spawns the provision command with correct env vars and cwd', async () => {
      vi.resetModules();
      const child = createChild();
      spawnMock.mockReturnValue(child);

      const { workspaceProviderService } = await import(
        '../../main/services/WorkspaceProviderService'
      );

      const instanceId = await workspaceProviderService.provision({
        taskId: 'task-1',
        repoUrl: 'git@github.com:org/repo.git',
        branch: 'emdash/fix-bug-abc',
        baseRef: 'main',
        provisionCommand: './scripts/create-workspace.sh',
        projectPath: '/home/user/project',
      });

      expect(instanceId).toBeTruthy();

      // Give the async runProvision a tick to call spawn
      await new Promise((r) => setTimeout(r, 50));

      expect(spawnMock).toHaveBeenCalledWith(
        'bash',
        ['-c', './scripts/create-workspace.sh'],
        expect.objectContaining({
          cwd: '/home/user/project',
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      );

      // Verify env vars
      const spawnEnv = spawnMock.mock.calls[0][2].env;
      expect(spawnEnv.EMDASH_TASK_ID).toBe('task-1');
      expect(spawnEnv.EMDASH_REPO_URL).toBe('git@github.com:org/repo.git');
      expect(spawnEnv.EMDASH_BRANCH).toBe('emdash/fix-bug-abc');
      expect(spawnEnv.EMDASH_BASE_REF).toBe('main');
      // Inherits parent env
      expect(spawnEnv.PATH).toBeDefined();
    });

    it('parses valid JSON stdout and emits provision-complete with ready', async () => {
      vi.resetModules();
      const child = createChild();
      spawnMock.mockReturnValue(child);

      const { workspaceProviderService } = await import(
        '../../main/services/WorkspaceProviderService'
      );

      const events: any[] = [];
      workspaceProviderService.on('provision-complete', (evt: any) => events.push(evt));

      await workspaceProviderService.provision({
        taskId: 'task-2',
        repoUrl: 'git@github.com:org/repo.git',
        branch: 'emdash/feat-x',
        baseRef: 'main',
        provisionCommand: './provision.sh',
        projectPath: '/project',
      });

      // Wait for spawn
      await new Promise((r) => setTimeout(r, 50));

      // Simulate script writing JSON to stdout and exiting
      const json = JSON.stringify({
        id: 'ws-42',
        host: 'workspace-ws-42',
        port: 2222,
        username: 'dev',
        worktreePath: '/home/dev/workspace',
      });
      child.stdout.emit('data', Buffer.from(json));
      child.emit('exit', 0);

      // Wait for async processing
      await new Promise((r) => setTimeout(r, 100));

      expect(events).toHaveLength(1);
      expect(events[0].status).toBe('ready');
    });

    it('emits provision-complete with error on invalid JSON', async () => {
      vi.resetModules();
      const child = createChild();
      spawnMock.mockReturnValue(child);

      const { workspaceProviderService } = await import(
        '../../main/services/WorkspaceProviderService'
      );

      const events: any[] = [];
      workspaceProviderService.on('provision-complete', (evt: any) => events.push(evt));

      await workspaceProviderService.provision({
        taskId: 'task-3',
        repoUrl: 'git@github.com:org/repo.git',
        branch: 'emdash/feat-y',
        baseRef: 'main',
        provisionCommand: './provision.sh',
        projectPath: '/project',
      });

      await new Promise((r) => setTimeout(r, 50));

      // Script writes garbage to stdout
      child.stdout.emit('data', Buffer.from('not json at all'));
      child.emit('exit', 0);

      await new Promise((r) => setTimeout(r, 100));

      expect(events).toHaveLength(1);
      expect(events[0].status).toBe('error');
      expect(events[0].error).toContain('not valid JSON');
    });

    it('emits provision-complete with error on non-zero exit code', async () => {
      vi.resetModules();
      const child = createChild();
      spawnMock.mockReturnValue(child);

      const { workspaceProviderService } = await import(
        '../../main/services/WorkspaceProviderService'
      );

      const events: any[] = [];
      workspaceProviderService.on('provision-complete', (evt: any) => events.push(evt));

      await workspaceProviderService.provision({
        taskId: 'task-4',
        repoUrl: 'git@github.com:org/repo.git',
        branch: 'emdash/feat-z',
        baseRef: 'main',
        provisionCommand: './provision.sh',
        projectPath: '/project',
      });

      await new Promise((r) => setTimeout(r, 50));

      child.stderr.emit('data', Buffer.from('Error: auth failed\n'));
      child.emit('exit', 1);

      await new Promise((r) => setTimeout(r, 100));

      expect(events).toHaveLength(1);
      expect(events[0].status).toBe('error');
      expect(events[0].error).toContain('exited with code 1');
    });

    it('streams stderr lines as provision-progress events', async () => {
      vi.resetModules();
      const child = createChild();
      spawnMock.mockReturnValue(child);

      const { workspaceProviderService } = await import(
        '../../main/services/WorkspaceProviderService'
      );

      const progressLines: string[] = [];
      workspaceProviderService.on('provision-progress', (evt: any) => progressLines.push(evt.line));

      await workspaceProviderService.provision({
        taskId: 'task-5',
        repoUrl: 'git@github.com:org/repo.git',
        branch: 'emdash/feat-a',
        baseRef: 'main',
        provisionCommand: './provision.sh',
        projectPath: '/project',
      });

      await new Promise((r) => setTimeout(r, 50));

      child.stderr.emit('data', Buffer.from('[INFO] Provisioning workspace...\n'));
      child.stderr.emit('data', Buffer.from('[INFO] Creating DNS record...\n'));

      expect(progressLines).toContain('[INFO] Provisioning workspace...');
      expect(progressLines).toContain('[INFO] Creating DNS record...');
    });

    it('emits error when JSON is missing required host field', async () => {
      vi.resetModules();
      const child = createChild();
      spawnMock.mockReturnValue(child);

      const { workspaceProviderService } = await import(
        '../../main/services/WorkspaceProviderService'
      );

      const events: any[] = [];
      workspaceProviderService.on('provision-complete', (evt: any) => events.push(evt));

      await workspaceProviderService.provision({
        taskId: 'task-6',
        repoUrl: 'git@github.com:org/repo.git',
        branch: 'emdash/feat-b',
        baseRef: 'main',
        provisionCommand: './provision.sh',
        projectPath: '/project',
      });

      await new Promise((r) => setTimeout(r, 50));

      // Valid JSON but missing host
      child.stdout.emit('data', Buffer.from('{"port": 22, "username": "dev"}'));
      child.emit('exit', 0);

      await new Promise((r) => setTimeout(r, 100));

      expect(events).toHaveLength(1);
      expect(events[0].status).toBe('error');
      expect(events[0].error).toContain('"host"');
    });

    it('works with minimal output (only host)', async () => {
      vi.resetModules();
      const child = createChild();
      spawnMock.mockReturnValue(child);

      const { workspaceProviderService } = await import(
        '../../main/services/WorkspaceProviderService'
      );

      const events: any[] = [];
      workspaceProviderService.on('provision-complete', (evt: any) => events.push(evt));

      await workspaceProviderService.provision({
        taskId: 'task-7',
        repoUrl: 'git@github.com:org/repo.git',
        branch: 'emdash/feat-c',
        baseRef: 'main',
        provisionCommand: './provision.sh',
        projectPath: '/project',
      });

      await new Promise((r) => setTimeout(r, 50));

      child.stdout.emit('data', Buffer.from('{"host": "workspace-test-1"}'));
      child.emit('exit', 0);

      await new Promise((r) => setTimeout(r, 100));

      expect(events).toHaveLength(1);
      expect(events[0].status).toBe('ready');
    });

    it('emits timeout warning at PROVISION_TIMEOUT_MS without killing process', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      vi.resetModules();
      const child = createChild();
      spawnMock.mockReturnValue(child);

      const { workspaceProviderService, PROVISION_TIMEOUT_MS } = await import(
        '../../main/services/WorkspaceProviderService'
      );

      const events: any[] = [];
      workspaceProviderService.on('provision-timeout-warning', (evt: any) => events.push(evt));

      const instanceId = await workspaceProviderService.provision({
        taskId: 'task-8',
        repoUrl: 'git@github.com:org/repo.git',
        branch: 'b',
        baseRef: 'main',
        provisionCommand: './p.sh',
        projectPath: '/p',
      });

      // advance past normal timeout, we iterate it so microtasks run
      await vi.advanceTimersByTimeAsync(PROVISION_TIMEOUT_MS + 1000);

      expect(child.kill).not.toHaveBeenCalled();
      expect(events).toHaveLength(1);
      expect(events[0].instanceId).toBe(instanceId);

      // clean up
      child.emit('exit', 0);
      vi.useRealTimers();
    });

    it('hard kills process at PROVISION_HARD_TIMEOUT_MS', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      vi.resetModules();
      const child = createChild();
      spawnMock.mockReturnValue(child);

      const { workspaceProviderService, PROVISION_HARD_TIMEOUT_MS } = await import(
        '../../main/services/WorkspaceProviderService'
      );

      const completeEvents: any[] = [];
      workspaceProviderService.on('provision-complete', (evt: any) => completeEvents.push(evt));

      await workspaceProviderService.provision({
        taskId: 'task-9',
        repoUrl: 'git',
        branch: 'b',
        baseRef: 'main',
        provisionCommand: './p.sh',
        projectPath: '/p',
      });

      // advance past hard timeout
      await vi.advanceTimersByTimeAsync(PROVISION_HARD_TIMEOUT_MS + 1000);

      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(completeEvents).toHaveLength(1);
      expect(completeEvents[0].status).toBe('error');
      expect(completeEvents[0].error).toContain('hard timed out');

      // clean up
      child.emit('exit', 0);
      vi.useRealTimers();
    });

    it('clears timeouts on successful exit', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      vi.resetModules();
      const child = createChild();
      spawnMock.mockReturnValue(child);

      const { workspaceProviderService, PROVISION_TIMEOUT_MS } = await import(
        '../../main/services/WorkspaceProviderService'
      );

      const warnEvents: any[] = [];
      workspaceProviderService.on('provision-timeout-warning', (evt: any) => warnEvents.push(evt));

      await workspaceProviderService.provision({
        taskId: 'task-10',
        repoUrl: 'git',
        branch: 'b',
        baseRef: 'main',
        provisionCommand: './p.sh',
        projectPath: '/p',
      });

      // Let microtasks tick for process spawn
      await vi.advanceTimersByTimeAsync(50);

      // exit before timeout
      child.emit('exit', 0);

      // advance past timeout
      await vi.advanceTimersByTimeAsync(PROVISION_TIMEOUT_MS + 1000);

      expect(warnEvents).toHaveLength(0); // Timers should have been cleared

      vi.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // cancel()
  // -------------------------------------------------------------------------
  describe('cancel', () => {
    it('kills the child process and marks instance as error', async () => {
      vi.resetModules();
      const child = createChild();
      spawnMock.mockReturnValue(child);

      const { workspaceProviderService } = await import(
        '../../main/services/WorkspaceProviderService'
      );

      const instanceId = await workspaceProviderService.provision({
        taskId: 'task-cancel',
        repoUrl: 'git@github.com:org/repo.git',
        branch: 'emdash/cancel-test',
        baseRef: 'main',
        provisionCommand: './provision.sh',
        projectPath: '/project',
      });

      await new Promise((r) => setTimeout(r, 50));

      await workspaceProviderService.cancel(instanceId);

      expect(child.killed).toBe(true);
      expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
    });
  });

  // -------------------------------------------------------------------------
  // parseProvisionOutput (tested indirectly via provision)
  // -------------------------------------------------------------------------
  describe('parseProvisionOutput edge cases', () => {
    it('rejects empty stdout', async () => {
      vi.resetModules();
      const child = createChild();
      spawnMock.mockReturnValue(child);

      const { workspaceProviderService } = await import(
        '../../main/services/WorkspaceProviderService'
      );

      const events: any[] = [];
      workspaceProviderService.on('provision-complete', (evt: any) => events.push(evt));

      await workspaceProviderService.provision({
        taskId: 'task-empty',
        repoUrl: 'git@github.com:org/repo.git',
        branch: 'emdash/empty',
        baseRef: 'main',
        provisionCommand: './provision.sh',
        projectPath: '/project',
      });

      await new Promise((r) => setTimeout(r, 50));

      // Script produces nothing on stdout
      child.emit('exit', 0);

      await new Promise((r) => setTimeout(r, 100));

      expect(events).toHaveLength(1);
      expect(events[0].status).toBe('error');
      expect(events[0].error).toContain('no output');
    });

    it('rejects array output', async () => {
      vi.resetModules();
      const child = createChild();
      spawnMock.mockReturnValue(child);

      const { workspaceProviderService } = await import(
        '../../main/services/WorkspaceProviderService'
      );

      const events: any[] = [];
      workspaceProviderService.on('provision-complete', (evt: any) => events.push(evt));

      await workspaceProviderService.provision({
        taskId: 'task-array',
        repoUrl: 'git@github.com:org/repo.git',
        branch: 'emdash/array',
        baseRef: 'main',
        provisionCommand: './provision.sh',
        projectPath: '/project',
      });

      await new Promise((r) => setTimeout(r, 50));

      child.stdout.emit('data', Buffer.from('[{"host": "x"}]'));
      child.emit('exit', 0);

      await new Promise((r) => setTimeout(r, 100));

      expect(events).toHaveLength(1);
      expect(events[0].status).toBe('error');
      expect(events[0].error).toContain('JSON object');
    });
  });
});
