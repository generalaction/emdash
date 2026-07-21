import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { ok } from '@emdash/shared';
import type * as WireModule from '@emdash/wire';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskProvider } from '@core/features/projects/api/node/project-provider';
import { executeTeardown } from '@core/features/tasks/api/node/task-session-manager';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';

const deactivateStart = vi.hoisted(() => vi.fn());
const teardownStart = vi.hoisted(() => vi.fn());
const jobRelease = vi.hoisted(() => vi.fn());
const jobDispose = vi.hoisted(() => vi.fn());
const deactivateParticipants = vi.hoisted(() => vi.fn());

vi.mock('@emdash/wire', async (importOriginal) => {
  const actual = await importOriginal<typeof WireModule>();
  return {
    ...actual,
    createLiveJobReplica: (definition: { id: string }) => ({
      start: definition.id.includes('teardown') ? teardownStart : deactivateStart,
      dispose: jobDispose,
    }),
  };
});

const dependencies = {
  db: {} as never,
  deactivateWorkspaceParticipants: deactivateParticipants,
  workspaceIdentity: {
    resolve: vi.fn(async () => ({
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      host: LOCAL_HOST_REF,
      path: '/repo/task',
    })),
  },
  runtimes: {
    client: async () =>
      ok({
        workspace: {
          deactivate: {},
          teardown: {},
          workspace: {
            state: () => ({
              asLiveSource: () => ({
                snapshot: async () => ({
                  generation: 1,
                  sequence: 0,
                  timestamp: 0,
                  data: { consumers: [] },
                }),
              }),
            }),
          },
        },
      }),
  },
} as never;

vi.mock('@core/features/tasks/node/session-targets', () => ({
  getTaskSessionLeafIds: vi.fn(),
}));

function makeTask() {
  const conversations = { detachAll: vi.fn(), destroyAll: vi.fn() };
  const task = { taskId: 'task-1', conversations } as unknown as TaskProvider;
  return { task, conversations };
}

describe('executeTeardown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const jobLease = {
      ready: async () => ({ result: Promise.resolve() }),
      release: jobRelease,
    };
    deactivateStart.mockResolvedValue(jobLease);
    teardownStart.mockResolvedValue(jobLease);
  });

  it('maps detach to runtime deactivation without teardown', async () => {
    const { task, conversations } = makeTask();
    await executeTeardown(dependencies, task, 'workspace-1', 'detach');

    expect(conversations.detachAll).toHaveBeenCalledOnce();
    expect(conversations.destroyAll).not.toHaveBeenCalled();
    expect(deactivateStart).toHaveBeenCalledWith({
      workspace: hostFileRefFromNativePath('/repo/task'),
      consumerId: 'task-1',
      strategy: 'detach',
      automation: undefined,
    });
    expect(teardownStart).not.toHaveBeenCalled();
  });

  it('maps terminate to deactivation followed by runtime teardown', async () => {
    const { task, conversations } = makeTask();
    const automation = {
      teardown: 'pnpm run teardown',
      autoRunSetup: true,
      autoRunRun: false,
    };

    await executeTeardown(dependencies, task, 'workspace-1', 'terminate', undefined, automation);

    expect(conversations.destroyAll).toHaveBeenCalledOnce();
    expect(deactivateStart).toHaveBeenCalledWith({
      workspace: hostFileRefFromNativePath('/repo/task'),
      consumerId: 'task-1',
      strategy: 'stop',
      automation,
    });
    expect(teardownStart).toHaveBeenCalledWith({
      workspace: hostFileRefFromNativePath('/repo/task'),
      force: false,
      automation,
    });
    expect(deactivateParticipants).toHaveBeenCalledOnce();
  });

  it('keeps archive teardown-free while stopping sessions', async () => {
    const { task, conversations } = makeTask();
    await executeTeardown(dependencies, task, 'workspace-1', 'archive');

    expect(conversations.destroyAll).toHaveBeenCalledOnce();
    expect(deactivateStart).toHaveBeenCalledWith(expect.objectContaining({ strategy: 'stop' }));
    expect(teardownStart).not.toHaveBeenCalled();
  });
});
