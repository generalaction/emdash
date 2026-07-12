import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  createRPCClient,
  createRPCController,
  createRPCNamespace,
  createRPCRouter,
  registerRPCRouter,
  withSender,
} from './rpc';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const vcsController = createRPCController({
  commit: (msg: string) => Promise.resolve(`committed: ${msg}`),
  status: () => Promise.resolve('clean'),
});

const fsController = createRPCController({
  read: (path: string) => Promise.resolve(`content of ${path}`),
  write: (path: string, data: string) => Promise.resolve(data.length),
});

const editorController = createRPCController({
  open: (file: string) => Promise.resolve(`opened ${file}`),
});

const catalogController = createRPCController({
  entries: () => Promise.resolve(['first']),
});

const terminalController = createRPCController({
  list: (dir: string) => Promise.resolve([dir]),
});

const workspaceNamespace = createRPCNamespace({
  editor: editorController,
  terminal: terminalController,
});

const router = createRPCRouter({
  vcs: vcsController,
  catalog: catalogController,
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
      return handler({ sender: { id: 42 } } /* _event */, ...args);
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

    await rpc.vcs.commit('hello');

    expect(invoke).toHaveBeenCalledWith('vcs.commit', 'hello');
  });

  it('calls invoke with the nested channel and args for a 3-level call', async () => {
    const invoke = vi.fn().mockResolvedValue('ok');
    const rpc = createRPCClient<Router>(invoke);

    await rpc.workspace.editor.open('README.md');

    expect(invoke).toHaveBeenCalledWith('workspace.editor.open', 'README.md');
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

    const result = await rpc.vcs.status();

    expect(result).toBe('clean');
  });

  it('constructs the correct channel for a second nested namespace', async () => {
    const invoke = vi.fn().mockResolvedValue([]);
    const rpc = createRPCClient<Router>(invoke);

    await rpc.workspace.terminal.list('projects');

    expect(invoke).toHaveBeenCalledWith('workspace.terminal.list', 'projects');
  });
});

// ---------------------------------------------------------------------------
// registerRPCRouter — runtime behavior
// ---------------------------------------------------------------------------

describe('registerRPCRouter', () => {
  it('registers flat handlers at their 2-segment channel', () => {
    const ipc = makeIpcMainStub();
    registerRPCRouter(router, ipc as never);

    expect(ipc.registeredChannels()).toContain('vcs.commit');
    expect(ipc.registeredChannels()).toContain('vcs.status');
    expect(ipc.registeredChannels()).toContain('fs.read');
    expect(ipc.registeredChannels()).toContain('fs.write');
  });

  it('registers nested handlers at their 3-segment channel', () => {
    const ipc = makeIpcMainStub();
    registerRPCRouter(router, ipc as never);

    expect(ipc.registeredChannels()).toContain('workspace.editor.open');
    expect(ipc.registeredChannels()).toContain('catalog.entries');
    expect(ipc.registeredChannels()).toContain('workspace.terminal.list');
  });

  it('calls through to the original handler function with args', async () => {
    const ipc = makeIpcMainStub();
    registerRPCRouter(router, ipc as never);

    const result = await ipc.invoke('vcs.commit', 'my message');
    expect(result).toBe('committed: my message');
  });

  it('calls through to a nested handler function with args', async () => {
    const ipc = makeIpcMainStub();
    registerRPCRouter(router, ipc as never);

    const result = await ipc.invoke('workspace.editor.open', 'README.md');
    expect(result).toBe('opened README.md');
  });

  it('passes sender id to sender-aware handlers without exposing it to callers', async () => {
    const senderController = createRPCController({
      currentWindow: withSender((senderId: number, label: string) => `${senderId}:${label}`),
    });
    const senderRouter = createRPCRouter({ sender: senderController });
    const ipc = makeIpcMainStub();
    registerRPCRouter(senderRouter, ipc as never);

    const result = await ipc.invoke('sender.currentWindow', 'active');

    expect(result).toBe('42:active');
    expectTypeOf(createRPCClient<typeof senderRouter>(vi.fn()).sender.currentWindow).toEqualTypeOf<
      (label: string) => Promise<string>
    >();
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
    expectTypeOf(rpc.vcs.commit).toEqualTypeOf<(msg: string) => Promise<string>>();
  });

  it('types a flat zero-arg procedure correctly', () => {
    expectTypeOf(rpc.vcs.status).toEqualTypeOf<() => Promise<string>>();
  });

  it('types a flat multi-arg procedure correctly', () => {
    expectTypeOf(rpc.fs.write).toEqualTypeOf<(path: string, data: string) => Promise<number>>();
  });

  it('types a nested procedure as an async function with the original signature', () => {
    expectTypeOf(rpc.workspace.editor.open).toEqualTypeOf<(file: string) => Promise<string>>();
  });

  it('types a nested namespace as a sub-namespace object, not a callable', () => {
    expectTypeOf(rpc.workspace).toEqualTypeOf<{
      editor: { open: (file: string) => Promise<string> };
      terminal: { list: (dir: string) => Promise<string[]> };
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
    // vcsController.commit returns Promise<string> — IpcClient should give Promise<string>, not Promise<Promise<string>>
    expectTypeOf(rpc.vcs.commit).returns.toEqualTypeOf<Promise<string>>();
  });
});
