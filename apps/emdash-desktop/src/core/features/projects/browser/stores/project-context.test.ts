import { ok } from '@emdash/shared';
import { deferred } from '@emdash/shared/testing';
import { cell, flushStateTurn, type RemoteModel } from '@emdash/wire/state';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectAttachmentState, projectsWireContract } from '@core/features/projects/api';
import { ProjectContext } from '@core/features/projects/api/browser/stores/project-context';
import { contributeScopedStore, scopedStoreToken } from '@core/primitives/scoped-stores/browser';
import type { hostsContract, HostAvailabilityState } from '@core/services/hosts/api';

const mocks = vi.hoisted(() => ({
  mementoReportError: vi.fn(),
  mementoSubject: vi.fn(),
  projectStoreContributions: [] as object[],
}));

vi.mock('@core/primitives/mementos/browser', () => ({
  getMementoClient: () => ({
    reportError: mocks.mementoReportError,
    subject: mocks.mementoSubject,
  }),
}));

vi.mock('@core/manifests/browser/project-scoped-stores', () => ({
  projectStoreContributions: mocks.projectStoreContributions,
}));

function availabilityModel(
  state: HostAvailabilityState = { kind: 'ready', generation: 1 },
  onRelease: () => void = () => {}
): RemoteModel<typeof hostsContract.availability> {
  const availability = cell(state);
  const member = {
    states: { state: availability },
    mutations: {},
  };
  return Object.assign(() => member, {
    retain: vi.fn(() => onRelease),
    peekMember: vi.fn(() => member),
    dispose: vi.fn(async () => {}),
  }) as unknown as RemoteModel<typeof hostsContract.availability>;
}

function attachmentModel(
  state: ProjectAttachmentState = { kind: 'absent' }
): RemoteModel<typeof projectsWireContract.attachments> {
  const attachment = cell(state);
  const member = {
    states: { state: attachment },
    mutations: {},
  };
  return Object.assign(() => member, {
    retain: vi.fn(() => vi.fn()),
    peekMember: vi.fn(() => member),
    dispose: vi.fn(async () => {}),
  }) as unknown as RemoteModel<typeof projectsWireContract.attachments>;
}

describe('ProjectContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectStoreContributions.length = 0;
  });

  it('rejects an invalid durable record before acquiring desktop resources', async () => {
    const result = await ProjectContext.hydrate({
      type: 'ssh',
      id: 'project-id',
      name: 'Project',
      connectionId: 'ssh-1',
    });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'invalid-project-record',
        message: expect.any(String),
      },
    });
    expect(mocks.mementoSubject).not.toHaveBeenCalled();
  });

  it('hydrates one desktop space and activates stores only after readiness', async () => {
    const events: string[] = [];
    let resolveSpace: () => void = () => {};
    let resolveStore: () => void = () => {};
    const space = {
      ready: new Promise<void>((resolve) => {
        resolveSpace = () => {
          events.push('space:ready');
          resolve();
        };
      }),
      release: vi.fn(),
    };
    const token = scopedStoreToken<{ id: string }>('test.store');
    let scopedHost: unknown;
    mocks.projectStoreContributions.push(
      contributeScopedStore({
        token,
        create: (context: { host: unknown }) => {
          scopedHost = context.host;
          events.push('store:create');
          return { id: 'store' };
        },
        ready: () =>
          new Promise<void>((resolve) => {
            resolveStore = () => {
              events.push('store:ready');
              resolve();
            };
          }),
        activate: () => events.push('store:activate'),
      })
    );
    mocks.mementoSubject.mockReturnValue(space);

    const hydration = ProjectContext.hydrate({
      type: 'local',
      id: 'project-id',
      name: 'Project',
      path: '/project',
      baseRef: 'main',
      repositoryWorkspaceId: null,
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
    });

    expect(events).toEqual(['store:create']);
    resolveStore();
    await Promise.resolve();
    expect(events).toEqual(['store:create', 'store:ready']);
    resolveSpace();
    const result = await hydration;

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(events).toEqual(['store:create', 'store:ready', 'space:ready', 'store:activate']);
    expect(mocks.mementoSubject).toHaveBeenCalledOnce();
    expect(result.data.get(token)).toEqual({ id: 'store' });
    expect(scopedHost).toBe(result.data.host);
  });

  it('classifies memento hydration failure as a desktop context error', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    mocks.mementoSubject.mockReturnValue({
      ready: Promise.reject(new Error('memento unavailable')),
      release,
    });

    const result = await ProjectContext.hydrate({
      type: 'local',
      id: 'project-id',
      name: 'Project',
      path: '/project',
      baseRef: 'main',
      repositoryWorkspaceId: null,
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
    });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'context-initialization-failed',
        stage: 'memento',
        message: 'memento unavailable',
      },
    });
    expect(release).toHaveBeenCalledOnce();
  });

  it('classifies scoped-store readiness failure as a desktop context error', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const dispose = vi.fn();
    mocks.mementoSubject.mockReturnValue({
      ready: Promise.resolve(),
      release,
    });
    mocks.projectStoreContributions.push(
      contributeScopedStore({
        token: scopedStoreToken('test.failing'),
        create: () => ({}),
        ready: async () => {
          throw new Error('store unavailable');
        },
        dispose,
      })
    );

    const result = await ProjectContext.hydrate({
      type: 'local',
      id: 'project-id',
      name: 'Project',
      path: '/project',
      baseRef: 'main',
      repositoryWorkspaceId: null,
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
    });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'context-initialization-failed',
        stage: 'scoped-stores',
        message: 'store unavailable',
      },
    });
    expect(dispose).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it('releases attachment tracking before stores and the subject space', async () => {
    const events: string[] = [];
    const releaseSpace = vi.fn(async () => {
      events.push('space:release');
    });
    mocks.mementoSubject.mockReturnValue({
      ready: Promise.resolve(),
      release: releaseSpace,
    });
    mocks.projectStoreContributions.push(
      contributeScopedStore({
        token: scopedStoreToken('test.disposable'),
        create: () => ({}),
        dispose: () => events.push('store:dispose'),
      })
    );
    const result = await ProjectContext.hydrate({
      type: 'local',
      id: 'project-id',
      name: 'Project',
      path: '/project',
      baseRef: 'main',
      repositoryWorkspaceId: null,
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
    });
    if (!result.success) throw new Error('Expected context hydration to succeed');
    const attachment = cell<ProjectAttachmentState>({ kind: 'absent' });
    const member = {
      states: { state: attachment },
      mutations: {},
    };
    const model = Object.assign(() => member, {
      retain: vi.fn(() => () => events.push('attachment:release')),
      peekMember: vi.fn(() => member),
      dispose: vi.fn(async () => {}),
    }) as unknown as RemoteModel<typeof projectsWireContract.attachments>;

    result.data.trackHostAccess(
      availabilityModel({ kind: 'ready', generation: 1 }, () =>
        events.push('availability:release')
      ),
      model
    );
    expect(result.data.host.state).toEqual({ kind: 'attaching' });
    await result.data.dispose();
    await result.data.dispose();

    expect(events).toEqual([
      'attachment:release',
      'availability:release',
      'store:dispose',
      'space:release',
    ]);
    expect(result.data.host.state).toEqual({ kind: 'offline' });
    expect(model.retain).toHaveBeenCalledOnce();
    expect(releaseSpace).toHaveBeenCalledOnce();
  });

  it('does not release the old attachment twice when replacement binding fails', async () => {
    mocks.mementoSubject.mockReturnValue({
      ready: Promise.resolve(),
      release: vi.fn().mockResolvedValue(undefined),
    });
    const result = await ProjectContext.hydrate({
      type: 'local',
      id: 'project-id',
      name: 'Project',
      path: '/project',
      baseRef: 'main',
      repositoryWorkspaceId: null,
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
    });
    if (!result.success) throw new Error('Expected context hydration to succeed');
    const firstRelease = vi.fn();
    const firstState = cell({ kind: 'absent' as const });
    const firstModel = Object.assign(() => ({ states: { state: firstState }, mutations: {} }), {
      retain: vi.fn(() => firstRelease),
      peekMember: vi.fn(),
      dispose: vi.fn(async () => {}),
    }) as unknown as RemoteModel<typeof projectsWireContract.attachments>;
    const failedRelease = vi.fn();
    const failedModel = Object.assign(
      () => {
        throw new Error('binding failed');
      },
      {
        retain: vi.fn(() => failedRelease),
        peekMember: vi.fn(),
        dispose: vi.fn(async () => {}),
      }
    ) as unknown as RemoteModel<typeof projectsWireContract.attachments>;

    result.data.trackHostAccess(availabilityModel(), firstModel);
    expect(() => result.data.trackHostAccess(availabilityModel(), failedModel)).toThrow(
      'binding failed'
    );
    await result.data.dispose();

    expect(firstRelease).toHaveBeenCalledOnce();
    expect(failedRelease).toHaveBeenCalledOnce();
    expect(result.data.host.state).toEqual({ kind: 'offline' });
  });

  it('derives live Host access without replacing the Project context', async () => {
    mocks.mementoSubject.mockReturnValue({
      ready: Promise.resolve(),
      release: vi.fn().mockResolvedValue(undefined),
    });
    const result = await ProjectContext.hydrate({
      type: 'local',
      id: 'project-id',
      name: 'Project',
      path: '/project',
      baseRef: 'main',
      repositoryWorkspaceId: null,
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
    });
    if (!result.success) throw new Error('Expected context hydration to succeed');

    const availability = cell<HostAvailabilityState>({
      kind: 'unavailable',
      recovery: 'eligible',
    });
    const availabilityMember = {
      states: { state: availability },
      mutations: {},
    };
    const availabilityModel = Object.assign(() => availabilityMember, {
      retain: vi.fn(() => vi.fn()),
      peekMember: vi.fn(() => availabilityMember),
      dispose: vi.fn(async () => {}),
    }) as unknown as RemoteModel<typeof hostsContract.availability>;
    const attachment = cell<ProjectAttachmentState>({ kind: 'absent' });
    const attachmentMember = {
      states: { state: attachment },
      mutations: {},
    };
    const attachmentModel = Object.assign(() => attachmentMember, {
      retain: vi.fn(() => vi.fn()),
      peekMember: vi.fn(() => attachmentMember),
      dispose: vi.fn(async () => {}),
    }) as unknown as RemoteModel<typeof projectsWireContract.attachments>;
    const context = result.data;

    context.trackHostAccess(availabilityModel, attachmentModel);
    expect(context.host.state).toEqual({ kind: 'offline' });

    availability.set({ kind: 'ready', generation: 2 });
    attachment.set({ kind: 'attaching', hostGeneration: 2, attemptId: 'attempt-1' });
    flushStateTurn();
    expect(context.host.state).toEqual({ kind: 'attaching' });

    attachment.set({ kind: 'attached', establishedHostGeneration: 2 });
    flushStateTurn();
    expect(context.host.state).toEqual({ kind: 'ready', hostGeneration: 2 });
    expect(result.data).toBe(context);

    availability.set({ kind: 'suspended', reason: 'user-disconnected' });
    flushStateTurn();
    expect(context.host.state).toEqual({ kind: 'offline' });
    expect(result.data).toBe(context);

    availability.set({ kind: 'ready', generation: 3 });
    flushStateTurn();
    expect(context.host.state).toEqual({ kind: 'ready', hostGeneration: 3 });
    expect(result.data).toBe(context);
  });

  it('acknowledges and coalesces recovery without claiming Host access is live', async () => {
    mocks.mementoSubject.mockReturnValue({
      ready: Promise.resolve(),
      release: vi.fn().mockResolvedValue(undefined),
    });
    const result = await ProjectContext.hydrate({
      type: 'local',
      id: 'project-id',
      name: 'Project',
      path: '/project',
      baseRef: 'main',
      repositoryWorkspaceId: null,
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
    });
    if (!result.success) throw new Error('Expected context hydration to succeed');
    const request = deferred<ReturnType<typeof ok<void>>>();
    const recover = vi.fn(() => request.promise);
    const context = result.data;

    context.trackHostAccess(
      availabilityModel({ kind: 'unavailable', recovery: 'manual' }),
      attachmentModel(),
      recover
    );

    expect(context.host.liveAction).toEqual({
      kind: 'disabled',
      state: { kind: 'offline' },
    });
    expect(context.host.requireLive()).toMatchObject({
      success: false,
      error: { type: 'host-unavailable', reason: 'offline' },
    });

    const first = context.host.recover();
    const repeated = context.host.recover();

    expect(repeated).toBe(first);
    expect(recover).toHaveBeenCalledOnce();
    expect(context.host.state).toEqual({ kind: 'offline' });
    request.resolve(ok());
    await expect(first).resolves.toEqual(ok());
    expect(context.host.requireLive().success).toBe(false);
  });
});
