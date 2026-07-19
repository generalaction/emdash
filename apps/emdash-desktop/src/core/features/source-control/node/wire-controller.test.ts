import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { err, ok } from '@emdash/shared';
import type { LiveSource } from '@emdash/wire';
import { encodeTopic } from '@emdash/wire/api';
import { describe, expect, it, vi } from 'vitest';
import { hostPathFromNative } from '@core/primitives/desktop-runtime/api';
import { sourceControlContract } from '../api';
import {
  sourceControlGitRuntimeContract as gitContract,
  type SourceControlRuntimeResolveError as RuntimeResolveError,
} from '../api/runtime-adapter';
import { createSourceControlWireController } from './wire-controller';

const projectIdentity = {
  projectId: 'project-1',
  workspaceId: 'repository-workspace-1',
  host: LOCAL_HOST_REF,
  path: '/repo',
} as const;

const checkoutIdentity = {
  projectId: 'project-1',
  workspaceId: 'workspace-1',
  host: LOCAL_HOST_REF,
  path: '/repo/worktree',
} as const;

describe('createSourceControlWireController', () => {
  it('resolves repository ids and holds one broker lease per attached state', async () => {
    const source = liveSource({ kind: 'ready', branches: [], tags: [] });
    const state = vi.fn(() => ({ asLiveSource: () => source }));
    const release = vi.fn(async () => {});
    const session = vi.fn(() => ({
      ready: async () => ok({ git: { repository: { model: { state } } } }),
      release,
    }));
    const resolveProject = vi.fn(async () => projectIdentity);
    const controller = createSourceControlWireController({
      runtimes: { session } as never,
      workspaceIdentity: {
        resolve: vi.fn(async () => checkoutIdentity),
        resolveProject,
      },
    });

    expect(session).not.toHaveBeenCalled();
    const topic = encodeTopic(sourceControlContract.repository.model.states.refs.id, {
      projectId: projectIdentity.projectId,
    });
    const lease = controller.acquireLive(topic);
    await expect(lease?.ready()).resolves.toBe(source);

    expect(resolveProject).toHaveBeenCalledWith(projectIdentity.projectId);
    expect(session).toHaveBeenCalledOnce();
    expect(state).toHaveBeenCalledWith(
      { repository: hostPathFromNative(projectIdentity.path) },
      'refs'
    );
    expect(release).not.toHaveBeenCalled();

    await lease?.release();
    expect(release).toHaveBeenCalledOnce();
  });

  it('acquires and releases a runtime session for each checkout procedure call', async () => {
    const getLog = vi.fn(async () => ok({ commits: [], totalCount: 0 }));
    const release = vi.fn(async () => {});
    const session = vi.fn(() => ({
      ready: async () => ok({ git: { checkout: { getLog } } }),
      release,
    }));
    const resolve = vi.fn(async () => checkoutIdentity);
    const controller = createSourceControlWireController({
      runtimes: { session } as never,
      workspaceIdentity: { resolve, resolveProject: vi.fn(async () => projectIdentity) },
    });

    await controller.call('checkout.getLog', { workspaceId: checkoutIdentity.workspaceId });
    await controller.call('checkout.getLog', { workspaceId: checkoutIdentity.workspaceId });

    expect(resolve).toHaveBeenCalledTimes(2);
    expect(session).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
    expect(getLog).toHaveBeenCalledWith(
      { checkout: hostPathFromNative(checkoutIdentity.path) },
      {}
    );
  });

  it('translates mutation selectors and cursors back to project identities', async () => {
    const mutate = vi.fn(async (_name, envelope) =>
      ok({
        data: undefined,
        cursors: [
          {
            model: gitContract.repository.model.states.remotes.id,
            key: envelope.key,
            cursor: { generation: 1, sequence: 2 },
          },
        ],
      })
    );
    const release = vi.fn(async () => {});
    const controller = createSourceControlWireController({
      runtimes: {
        session: () => ({
          ready: async () => ok({ git: { repository: { model: { mutate } } } }),
          release,
        }),
      } as never,
      workspaceIdentity: {
        resolve: vi.fn(async () => checkoutIdentity),
        resolveProject: vi.fn(async () => projectIdentity),
      },
    });
    const key = { projectId: projectIdentity.projectId };

    const result = await controller.call('repository.model.addRemote', {
      key,
      input: { name: 'upstream', url: 'git@example.com:org/repo.git' },
      mutationId: 'mutation-1',
    });

    expect(mutate).toHaveBeenCalledWith('addRemote', {
      key: { repository: hostPathFromNative(projectIdentity.path) },
      input: { name: 'upstream', url: 'git@example.com:org/repo.git' },
      mutationId: 'mutation-1',
    });
    expect(result).toEqual(
      ok({
        data: undefined,
        cursors: [
          {
            model: sourceControlContract.repository.model.states.remotes.id,
            key,
            cursor: { generation: 1, sequence: 2 },
          },
        ],
      })
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it('returns RuntimeResolveError from fallible procedures and mutations', async () => {
    const resolveError: RuntimeResolveError = {
      type: 'host-unavailable',
      host: LOCAL_HOST_REF,
      message: 'Runtime unavailable',
    };
    const release = vi.fn(async () => {});
    const controller = createSourceControlWireController({
      runtimes: {
        session: () => ({
          ready: async () => err(resolveError),
          release,
        }),
      } as never,
      workspaceIdentity: {
        resolve: vi.fn(async () => checkoutIdentity),
        resolveProject: vi.fn(async () => projectIdentity),
      },
    });

    await expect(
      controller.call('checkout.getLog', { workspaceId: checkoutIdentity.workspaceId })
    ).resolves.toEqual(err(resolveError));
    await expect(
      controller.call('repository.model.addRemote', {
        key: { projectId: projectIdentity.projectId },
        input: { name: 'upstream', url: 'git@example.com:org/repo.git' },
        mutationId: 'mutation-1',
      })
    ).resolves.toEqual(err(resolveError));
    expect(release).toHaveBeenCalledTimes(2);
  });
});

function liveSource(data: unknown): LiveSource {
  return {
    snapshot: async () => ({ generation: 1, sequence: 0, timestamp: 0, data }),
    subscribe: () => () => {},
  };
}
