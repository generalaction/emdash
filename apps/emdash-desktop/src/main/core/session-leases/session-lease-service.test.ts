import { describe, expect, it, vi } from 'vitest';
import {
  SessionLeaseService,
  type AcquireSessionLeaseInput,
  type ResolvedResource,
} from './session-lease-service';

vi.mock('@main/core/acp/controller', () => ({ getAcpRuntimeClient: vi.fn() }));
vi.mock('@main/core/conversations/dehydrateConversation', () => ({
  dehydrateConversation: vi.fn(),
}));
vi.mock('@main/core/conversations/hydrateConversation', () => ({
  hydrateConversation: vi.fn(),
}));
vi.mock('@main/core/conversations/utils', () => ({
  mapConversationRowToConversation: vi.fn(),
}));
vi.mock('@main/core/pty/pty-session-registry', () => ({
  ptySessionRegistry: { get: vi.fn() },
}));
vi.mock('@main/core/tasks/task-session-manager', () => ({
  taskSessionManager: { getBootstrapStatus: vi.fn(), getPersistData: vi.fn() },
}));
vi.mock('@main/core/terminals/hydrateTerminal', () => ({ hydrateTerminal: vi.fn() }));
vi.mock('@main/core/workspaces/workspace-registry', () => ({
  workspaceRegistry: { get: vi.fn() },
}));
vi.mock('@main/db/client', () => ({ db: {} }));
vi.mock('@main/db/schema', () => ({ conversations: {}, terminals: {} }));
vi.mock('@shared/core/pty/ptySessionId', () => ({ makePtySessionId: vi.fn() }));

function input(
  ownerType: 'desktop' | 'mobile',
  ownerId: string,
  kind: AcquireSessionLeaseInput['kind'] = 'conversation'
): AcquireSessionLeaseInput {
  return {
    kind,
    projectId: 'project-1',
    taskId: 'task-1',
    resourceId: 'resource-1',
    ownerType,
    ownerId,
  };
}

function resolved(value: AcquireSessionLeaseInput): ResolvedResource {
  return {
    actualKind: value.kind,
    projectId: value.projectId,
    taskId: value.taskId,
    resourceId: value.resourceId,
    sessionId: 'project-1:task-1:resource-1',
  };
}

function harness() {
  let nextId = 0;
  const startResource = vi.fn().mockResolvedValue(undefined);
  const stopResource = vi.fn().mockResolvedValue(undefined);
  const service = new SessionLeaseService({
    resolveResource: async (value) => resolved(value),
    startResource,
    stopResource,
    createLeaseId: () => `lease-${++nextId}`,
  });
  return { service, startResource, stopResource };
}

describe('SessionLeaseService', () => {
  it('starts once and retains a resource until the final owner releases it', async () => {
    const { service, startResource, stopResource } = harness();
    const desktop = await service.acquire(input('desktop', 'desktop-1'));
    const mobile = await service.acquire(input('mobile', 'mobile-1'));

    expect(startResource).toHaveBeenCalledTimes(1);

    await service.release(desktop.id);
    expect(stopResource).not.toHaveBeenCalled();
    expect(service.get(mobile.id)).toBeDefined();

    await service.release(mobile.id);
    expect(stopResource).toHaveBeenCalledTimes(1);
    expect(service.get(mobile.id)).toBeUndefined();
  });

  it('deduplicates repeated acquisition by the same owner', async () => {
    const { service, startResource } = harness();
    const first = await service.acquire(input('mobile', 'phone-1', 'acp'));
    const second = await service.acquire(input('mobile', 'phone-1', 'acp'));

    expect(second.id).toBe(first.id);
    expect(startResource).toHaveBeenCalledTimes(1);

    await service.release(first.id);
  });

  it('keeps the final lease registered when teardown fails so release can be retried', async () => {
    const { service, stopResource } = harness();
    stopResource.mockRejectedValueOnce(new Error('temporary detach failure'));
    const lease = await service.acquire(input('mobile', 'phone-1'));

    await expect(service.release(lease.id)).rejects.toThrow('temporary detach failure');
    expect(service.get(lease.id)).toEqual(lease);

    await service.release(lease.id);
    expect(stopResource).toHaveBeenCalledTimes(2);
    expect(service.get(lease.id)).toBeUndefined();
  });

  it('releases every lease owned by a disconnected client', async () => {
    const { service, stopResource } = harness();
    const first = await service.acquire(input('mobile', 'phone-1'));
    const second = await service.acquire({
      ...input('mobile', 'phone-1', 'terminal'),
      resourceId: 'resource-2',
    });

    await service.releaseOwner('mobile', 'phone-1');

    expect(service.get(first.id)).toBeUndefined();
    expect(service.get(second.id)).toBeUndefined();
    expect(stopResource).toHaveBeenCalledTimes(2);
  });
});
