import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  createRPCClient,
  createRPCController,
  createRPCNamespace,
  createRPCRouter,
  registerRPCRouter,
} from './rpc';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const gitController = createRPCController({
  commit: (msg: string) => Promise.resolve(`committed: ${msg}`),
  status: () => Promise.resolve('clean'),
});

const fsController = createRPCController({
  read: (path: string) => Promise.resolve(`content of ${path}`),
  write: (path: string, data: string) => Promise.resolve(data.length),
});

const wsGitController = createRPCController({
  clone: (url: string) => Promise.resolve(`cloned ${url}`),
});

const wsFsController = createRPCController({
  list: (dir: string) => Promise.resolve([dir]),
});

const workspaceNamespace = createRPCNamespace({
  git: wsGitController,
  fs: wsFsController,
});

const router = createRPCRouter({
  git: gitController,
  fs: fsController,
  workspace: workspaceNamespace,
});

type Router = typeof router;

// Minimal IpcMain stub — only the `handle` method is needed.
function makeIpcMainStub() {
  const registered = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handle(channel: string, handler: (...args: unknown[]) => unknown) {
      registered.set(channel, handler);
    },
    invoke(channel: string, ...args: unknown[]) {
      const handler = registered.get(channel);
      if (!handler) throw new Error(`No handler registered for channel: ${channel}`);
      return handler({} /* _event */, ...args);
    },
    registeredChannels() {
      return [...registered.keys()];
    },
  };
}

// ---------------------------------------------------------------------------
// createRPCClient — runtime behavior
// ---------------------------------------------------------------------------

describe('createRPCClient', () => {
  it('calls invoke with the flat channel and args for a 2-level call', async () => {
    const invoke = vi.fn().mockResolvedValue('ok');
    const rpc = createRPCClient<Router>(invoke);

    await rpc.git.commit('hello');

    expect(invoke).toHaveBeenCalledWith('git.commit', 'hello');
  });

  it('calls invoke with the nested channel and args for a 3-level call', async () => {
    const invoke = vi.fn().mockResolvedValue('ok');
    const rpc = createRPCClient<Router>(invoke);

    await rpc.workspace.git.clone('https://example.com/repo');

    expect(invoke).toHaveBeenCalledWith('workspace.git.clone', 'https://example.com/repo');
  });

  it('forwards multiple arguments correctly', async () => {
    const invoke = vi.fn().mockResolvedValue(0);
    const rpc = createRPCClient<Router>(invoke);

    await rpc.fs.write('file.txt', 'content');

    expect(invoke).toHaveBeenCalledWith('fs.write', 'file.txt', 'content');
  });

  it('returns the value resolved by invoke', async () => {
    const invoke = vi.fn().mockResolvedValue('clean');
    const rpc = createRPCClient<Router>(invoke);

    const result = await rpc.git.status();

    expect(result).toBe('clean');
  });

  it('constructs the correct channel for a second nested namespace', async () => {
    const invoke = vi.fn().mockResolvedValue([]);
    const rpc = createRPCClient<Router>(invoke);

    await rpc.workspace.fs.list('projects');

    expect(invoke).toHaveBeenCalledWith('workspace.fs.list', 'projects');
  });
});

// ---------------------------------------------------------------------------
// registerRPCRouter — runtime behavior
// ---------------------------------------------------------------------------

describe('registerRPCRouter', () => {
  it('registers flat handlers at their 2-segment channel', () => {
    const ipc = makeIpcMainStub();
    registerRPCRouter(router, ipc as never);

    expect(ipc.registeredChannels()).toContain('git.commit');
    expect(ipc.registeredChannels()).toContain('git.status');
    expect(ipc.registeredChannels()).toContain('fs.read');
    expect(ipc.registeredChannels()).toContain('fs.write');
  });

  it('registers nested handlers at their 3-segment channel', () => {
    const ipc = makeIpcMainStub();
    registerRPCRouter(router, ipc as never);

    expect(ipc.registeredChannels()).toContain('workspace.git.clone');
    expect(ipc.registeredChannels()).toContain('workspace.fs.list');
  });

  it('calls through to the original handler function with args', async () => {
    const ipc = makeIpcMainStub();
    registerRPCRouter(router, ipc as never);

    const result = await ipc.invoke('git.commit', 'my message');
    expect(result).toBe('committed: my message');
  });

  it('calls through to a nested handler function with args', async () => {
    const ipc = makeIpcMainStub();
    registerRPCRouter(router, ipc as never);

    const result = await ipc.invoke('workspace.git.clone', 'https://example.com');
    expect(result).toBe('cloned https://example.com');
  });

  it('does not register any channel for non-function, non-object values', () => {
    const ipc = makeIpcMainStub();
    // @ts-expect-error intentionally passing an invalid router value to test robustness
    registerRPCRouter({ broken: null }, ipc as never);
    expect(ipc.registeredChannels()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// IpcClient type-safety (compile-time, verified by expectTypeOf)
// ---------------------------------------------------------------------------

describe('IpcClient type-safety', () => {
  const invoke = vi.fn().mockResolvedValue(undefined);
  const rpc = createRPCClient<Router>(invoke);

  it('types a flat procedure as an async function with the original signature', () => {
    expectTypeOf(rpc.git.commit).toEqualTypeOf<(msg: string) => Promise<string>>();
  });

  it('types a flat zero-arg procedure correctly', () => {
    expectTypeOf(rpc.git.status).toEqualTypeOf<() => Promise<string>>();
  });

  it('types a flat multi-arg procedure correctly', () => {
    expectTypeOf(rpc.fs.write).toEqualTypeOf<(path: string, data: string) => Promise<number>>();
  });

  it('types a nested procedure as an async function with the original signature', () => {
    expectTypeOf(rpc.workspace.git.clone).toEqualTypeOf<(url: string) => Promise<string>>();
  });

  it('types a nested namespace as a sub-namespace object, not a callable', () => {
    expectTypeOf(rpc.workspace).toEqualTypeOf<{
      git: { clone: (url: string) => Promise<string> };
      fs: { list: (dir: string) => Promise<string[]> };
    }>();
  });

  it('wraps a synchronous return value in Promise', () => {
    const syncController = createRPCController({
      greet: (name: string) => `Hello, ${name}`,
    });
    const syncRouter = createRPCRouter({ greeter: syncController });
    type SyncRouter = typeof syncRouter;

    const syncRpc = createRPCClient<SyncRouter>(invoke);
    expectTypeOf(syncRpc.greeter.greet).toEqualTypeOf<(name: string) => Promise<string>>();
  });

  it('unwraps a Promise return value so it is not double-wrapped', () => {
    // gitController.commit returns Promise<string> — IpcClient should give Promise<string>, not Promise<Promise<string>>
    expectTypeOf(rpc.git.commit).returns.toEqualTypeOf<Promise<string>>();
  });
});
