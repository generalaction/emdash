import { beforeEach, describe, expect, it, vi } from 'vitest';

const ipcHandleHandlers = new Map<string, (...args: any[]) => any>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, cb: (...args: any[]) => any) => {
      ipcHandleHandlers.set(channel, cb);
    }),
  },
  shell: { openExternal: vi.fn() },
}));

// Mock heavy deps that fsIpc pulls in but are irrelevant to resolvePreviewUrl
vi.mock('worker_threads', () => ({ Worker: vi.fn() }));
vi.mock('../../main/services/ssh/SshService', () => ({ sshService: {} }));
vi.mock('../../main/services/fs/RemoteFileSystem', () => ({ RemoteFileSystem: vi.fn() }));
vi.mock('../../main/utils/fsIgnores', () => ({ DEFAULT_IGNORES: [] }));
vi.mock('../../main/utils/safeStat', () => ({ safeStat: vi.fn() }));
vi.mock('../../main/utils/gitIgnore', () => ({ GitIgnoreParser: vi.fn() }));

const fsMock = {
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
};

vi.mock('fs', () => fsMock);

async function getHandler() {
  const { registerFsIpc } = await import('../../main/services/fsIpc');
  registerFsIpc();
  const handler = ipcHandleHandlers.get('fs:resolvePreviewUrl');
  expect(handler).toBeTypeOf('function');
  return handler!;
}

describe('fs:resolvePreviewUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
    ipcHandleHandlers.clear();
  });

  it('returns null when .emdash.json does not exist', async () => {
    fsMock.existsSync.mockReturnValue(false);
    const handler = await getHandler();
    const result = await handler({}, { projectPath: '/tmp/repo' });
    expect(result).toEqual({ success: true, url: null });
  });

  it('returns null when openBrowserUrl is not set in config', async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify({ scripts: { run: 'npm start' } }));
    const handler = await getHandler();
    const result = await handler({}, { projectPath: '/tmp/repo' });
    expect(result).toEqual({ success: true, url: null });
  });

  it('returns null when openBrowserUrl is blank', async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify({ openBrowserUrl: '   ' }));
    const handler = await getHandler();
    const result = await handler({}, { projectPath: '/tmp/repo' });
    expect(result).toEqual({ success: true, url: null });
  });

  it('returns a static URL unchanged', async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({ openBrowserUrl: 'http://localhost:3000' })
    );
    const handler = await getHandler();
    const result = await handler({}, { projectPath: '/tmp/repo' });
    expect(result).toEqual({ success: true, url: 'http://localhost:3000' });
  });

  it('expands $VAR from taskEnvVars', async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({ openBrowserUrl: 'http://localhost:$EMDASH_PORT' })
    );
    const handler = await getHandler();
    const result = await handler(
      {},
      {
        projectPath: '/tmp/repo',
        taskEnvVars: { EMDASH_PORT: '8080' },
      }
    );
    expect(result).toEqual({ success: true, url: 'http://localhost:8080' });
  });

  it('expands ${VAR} syntax', async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({ openBrowserUrl: 'http://${EMDASH_TASK_NAME}.localhost' })
    );
    const handler = await getHandler();
    const result = await handler(
      {},
      {
        projectPath: '/tmp/repo',
        taskEnvVars: { EMDASH_TASK_NAME: 'my-feature' },
      }
    );
    expect(result).toEqual({ success: true, url: 'http://my-feature.localhost' });
  });

  it('expands allowlisted host vars', async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({ openBrowserUrl: 'http://$USER.internal' })
    );
    vi.stubEnv('USER', 'alice');
    const handler = await getHandler();
    const result = await handler({}, { projectPath: '/tmp/repo' });
    expect(result).toEqual({ success: true, url: 'http://alice.internal' });
  });

  it('leaves unresolvable vars unexpanded', async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({ openBrowserUrl: 'http://localhost:$UNKNOWN_VAR' })
    );
    // Make sure UNKNOWN_VAR is not in process.env
    delete process.env.UNKNOWN_VAR;
    const handler = await getHandler();
    const result = await handler({}, { projectPath: '/tmp/repo' });
    expect(result).toEqual({ success: true, url: 'http://localhost:$UNKNOWN_VAR' });
  });

  it('returns error when projectPath is missing', async () => {
    const handler = await getHandler();
    const result = await handler({}, { projectPath: '' });
    expect(result).toMatchObject({ success: false });
  });
});
