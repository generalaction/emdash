import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMobileDomainSession } from './controller';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
  releaseOwner: vi.fn(),
  canResize: vi.fn(),
  getReadyTaskContext: vi.fn(),
  eventOn: vi.fn(),
  ptySubscribe: vi.fn(),
  ptyUnsubscribe: vi.fn(),
  markConversationSeen: vi.fn(),
  createMobileAgent: vi.fn(),
  createMobileTerminal: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: { select: mocks.select },
}));

vi.mock('@main/core/acp/controller', () => ({
  getAcpRuntimeClient: vi.fn(),
}));

vi.mock('@main/core/conversations/markConversationSeen', () => ({
  markConversationSeen: mocks.markConversationSeen,
}));

vi.mock('@main/core/conversations/renameConversation', () => ({
  renameConversation: vi.fn(),
}));

vi.mock('@main/core/pty/controller', () => ({
  ptyController: { sendInput: vi.fn(), resize: vi.fn() },
}));

vi.mock('@main/core/pty/pty-session-registry', () => ({
  ptySessionRegistry: {
    subscribe: mocks.ptySubscribe,
    unsubscribe: mocks.ptyUnsubscribe,
  },
}));

vi.mock('@main/core/session-leases/session-lease-service', () => ({
  sessionLeaseService: {
    acquire: mocks.acquire,
    release: mocks.release,
    releaseOwner: mocks.releaseOwner,
    canResize: mocks.canResize,
  },
}));

vi.mock('@main/core/terminals/renameTerminal', () => ({
  renameTerminal: vi.fn(),
}));

vi.mock('@main/lib/events', () => ({
  events: { on: mocks.eventOn },
}));

vi.mock('@main/lib/logger', () => ({
  log: { warn: mocks.logWarn },
}));

vi.mock('./catalog', () => ({
  buildMobileCatalog: vi.fn(),
}));

vi.mock('./creation', () => ({
  createMobileAgent: mocks.createMobileAgent,
  createMobileTerminal: mocks.createMobileTerminal,
  getMobileCreationOptions: vi.fn(),
}));

vi.mock('./files-and-diffs', () => ({
  listMobileDiffs: vi.fn(),
  listMobileFiles: vi.fn(),
  readMobileDiff: vi.fn(),
  readMobileFile: vi.fn(),
}));

vi.mock('./task-context', () => ({
  getReadyTaskContext: mocks.getReadyTaskContext,
}));

const terminal = {
  id: 'terminal-1',
  projectId: 'project-1',
  taskId: 'task-1',
  name: 'Terminal 1',
};

const lease = {
  id: 'lease-1',
  kind: 'terminal' as const,
  actualKind: 'terminal' as const,
  projectId: terminal.projectId,
  taskId: terminal.taskId,
  resourceId: terminal.id,
  ownerType: 'mobile' as const,
  ownerId: 'phone-1',
};

type FallibleResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };

function successfulData<T>(value: unknown): T {
  const result = value as FallibleResult<T>;
  expect(result.success).toBe(true);
  if (!result.success) throw new Error(result.error.message);
  return result.data;
}

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function mockTerminalQuery() {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn().mockResolvedValue([terminal]),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
}

describe('mobile domain controller lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTerminalQuery();
    mocks.acquire.mockResolvedValue(lease);
    mocks.release.mockResolvedValue(undefined);
    mocks.releaseOwner.mockResolvedValue(undefined);
    mocks.getReadyTaskContext.mockResolvedValue(undefined);
    mocks.eventOn.mockReturnValue(vi.fn());
    mocks.ptySubscribe.mockReturnValue('');
    mocks.markConversationSeen.mockResolvedValue(undefined);
    mocks.createMobileTerminal.mockResolvedValue({
      success: true,
      data: { id: terminal.id },
    });
  });

  it('coalesces concurrent duplicate opens into one lease and one handle', async () => {
    const acquired = deferred<typeof lease>();
    mocks.acquire.mockReturnValue(acquired.promise);
    const session = createMobileDomainSession('phone-1');

    const first = session.controller.call('openResource', {
      kind: 'terminal',
      resourceId: terminal.id,
    });
    const second = session.controller.call('openResource', {
      kind: 'terminal',
      resourceId: terminal.id,
    });
    await vi.waitFor(() => expect(mocks.acquire).toHaveBeenCalledTimes(1));
    acquired.resolve(lease);

    const [firstHandle, secondHandle] = await Promise.all([first, second]);
    expect(successfulData(firstHandle)).toEqual(successfulData(secondHandle));
    expect(mocks.select).toHaveBeenCalledTimes(1);
    expect(mocks.getReadyTaskContext).toHaveBeenCalledTimes(1);
    expect(mocks.acquire).toHaveBeenCalledTimes(1);

    await session.dispose();
  });

  it('retains a handle when teardown fails so close can be retried', async () => {
    const teardownError = new Error('Transient teardown failure');
    mocks.release.mockRejectedValueOnce(teardownError).mockResolvedValue(undefined);
    const session = createMobileDomainSession('phone-1');
    const opened = successfulData<{ id: string }>(
      await session.controller.call('openResource', {
        kind: 'terminal',
        resourceId: terminal.id,
      })
    );

    await expect(
      session.controller.call('closeResource', { handleId: opened.id })
    ).resolves.toEqual({
      success: false,
      error: { code: 'runtime_error', message: teardownError.message },
    });
    await expect(
      session.controller.call('closeResource', { handleId: opened.id })
    ).resolves.toEqual({ success: true, data: undefined });
    await session.controller.call('closeResource', { handleId: opened.id });

    expect(mocks.release).toHaveBeenCalledTimes(2);
    expect(mocks.release).toHaveBeenNthCalledWith(1, lease.id);
    expect(mocks.release).toHaveBeenNthCalledWith(2, lease.id);
    await session.dispose();
  });

  it('waits for an in-flight open, rolls its lease back, and releases the owner on dispose', async () => {
    const acquired = deferred<typeof lease>();
    mocks.acquire.mockReturnValue(acquired.promise);
    const session = createMobileDomainSession('phone-1');
    const opening = session.controller.call('openResource', {
      kind: 'terminal',
      resourceId: terminal.id,
    });
    await vi.waitFor(() => expect(mocks.acquire).toHaveBeenCalledTimes(1));

    const disposing = session.dispose();
    expect(mocks.releaseOwner).not.toHaveBeenCalled();
    acquired.resolve(lease);

    await expect(opening).resolves.toEqual({
      success: false,
      error: { code: 'not_available', message: 'Mobile connection is closed' },
    });
    await disposing;

    expect(mocks.release).toHaveBeenCalledWith(lease.id);
    expect(mocks.releaseOwner).toHaveBeenCalledWith('mobile', 'phone-1');
  });

  it('replays a completed creation for the same client after reconnecting', async () => {
    const request = {
      requestId: '11111111-1111-4111-8111-111111111111',
      taskId: terminal.taskId,
      shellId: 'bash',
    };
    const firstSession = createMobileDomainSession('connection-1', 'stable-client');
    const first = successfulData<{ resourceId: string }>(
      await firstSession.controller.call('createTerminal', request)
    );
    await firstSession.dispose();

    const secondSession = createMobileDomainSession('connection-2', 'stable-client');
    const replayed = successfulData<{ resourceId: string }>(
      await secondSession.controller.call('createTerminal', request)
    );

    expect(first.resourceId).toBe(terminal.id);
    expect(replayed.resourceId).toBe(terminal.id);
    expect(mocks.createMobileTerminal).toHaveBeenCalledTimes(1);
    expect(mocks.acquire).toHaveBeenCalledTimes(2);
    await secondSession.dispose();
  });

  it('rejects creation request ID reuse with a different payload', async () => {
    const requestId = '22222222-2222-4222-8222-222222222222';
    const firstSession = createMobileDomainSession('connection-1', 'conflict-client');
    successfulData(
      await firstSession.controller.call('createTerminal', {
        requestId,
        taskId: terminal.taskId,
        shellId: 'bash',
      })
    );
    await firstSession.dispose();

    const secondSession = createMobileDomainSession('connection-2', 'conflict-client');
    await expect(
      secondSession.controller.call('createTerminal', {
        requestId,
        taskId: terminal.taskId,
        shellId: 'zsh',
      })
    ).resolves.toEqual({
      success: false,
      error: { code: 'conflict', message: 'This creation request ID was already used' },
    });

    expect(mocks.createMobileTerminal).toHaveBeenCalledTimes(1);
    expect(mocks.acquire).toHaveBeenCalledTimes(1);
    await secondSession.dispose();
  });
});
