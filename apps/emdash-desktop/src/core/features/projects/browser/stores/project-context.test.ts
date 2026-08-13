import { cell, type RemoteModel } from '@emdash/wire/state';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { projectsWireContract } from '@core/features/projects/api';
import { ProjectContext } from '@core/features/projects/api/browser/stores/project-context';
import { contributeScopedStore, scopedStoreToken } from '@core/primitives/scoped-stores/browser';

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
    const attachment = cell({ kind: 'absent' as const });
    const member = {
      states: { state: attachment },
      mutations: {},
    };
    const model = Object.assign(() => member, {
      retain: vi.fn(() => () => events.push('attachment:release')),
      peekMember: vi.fn(() => member),
      dispose: vi.fn(async () => {}),
    }) as unknown as RemoteModel<typeof projectsWireContract.attachments>;

    result.data.trackAttachment(model);
    expect(result.data.host.attachment).toBe(attachment);
    await result.data.dispose();
    await result.data.dispose();

    expect(events).toEqual(['attachment:release', 'store:dispose', 'space:release']);
    expect(result.data.host.attachment).toBeUndefined();
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

    result.data.trackAttachment(firstModel);
    expect(() => result.data.trackAttachment(failedModel)).toThrow('binding failed');
    await result.data.dispose();

    expect(firstRelease).toHaveBeenCalledOnce();
    expect(failedRelease).toHaveBeenCalledOnce();
    expect(result.data.host.attachment).toBeUndefined();
  });
});
