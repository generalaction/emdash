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
  it('resolves repository ids and clients for attached state', async () => {
    const source = liveSource({ kind: 'ready', branches: [], tags: [] });
    const state = vi.fn(() => ({ asLiveSource: () => source }));
    const client = vi.fn(async () => ok({ git: { repository: { model: { state } } } }));
    const resolveProject = vi.fn(async () => projectIdentity);
    const controller = createSourceControlWireController({
      runtimes: { client } as never,
      workspaceIdentity: {
        resolve: vi.fn(async () => checkoutIdentity),
        resolveProject,
      },
    });

    expect(client).not.toHaveBeenCalled();
    const topic = encodeTopic(sourceControlContract.repository.model.states.refs.id, {
      projectId: projectIdentity.projectId,
    });
    const lease = controller.acquireLive(topic);
    await expect(lease?.ready()).resolves.toBe(source);

    expect(resolveProject).toHaveBeenCalledWith(projectIdentity.projectId);
    expect(client).toHaveBeenCalledOnce();
    expect(state).toHaveBeenCalledWith(
      { repository: hostPathFromNative(projectIdentity.path) },
      'refs'
    );

    await lease?.release();
  });

  it('resolves a runtime client for each checkout procedure call', async () => {
    const getLog = vi.fn(async () => ok({ commits: [], totalCount: 0 }));
    const client = vi.fn(async () => ok({ git: { checkout: { getLog } } }));
    const resolve = vi.fn(async () => checkoutIdentity);
    const controller = createSourceControlWireController({
      runtimes: { client } as never,
      workspaceIdentity: { resolve, resolveProject: vi.fn(async () => projectIdentity) },
    });

    await controller.call('checkout.getLog', { workspaceId: checkoutIdentity.workspaceId });
    await controller.call('checkout.getLog', { workspaceId: checkoutIdentity.workspaceId });

    expect(resolve).toHaveBeenCalledTimes(2);
    expect(client).toHaveBeenCalledTimes(2);
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
    const controller = createSourceControlWireController({
      runtimes: {
        client: async () => ok({ git: { repository: { model: { mutate } } } }),
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
  });

  it('returns RuntimeResolveError from fallible procedures and mutations', async () => {
    const resolveError: RuntimeResolveError = {
      type: 'host-unavailable',
      host: LOCAL_HOST_REF,
      message: 'Runtime unavailable',
    };
    const controller = createSourceControlWireController({
      runtimes: {
        client: async () => err(resolveError),
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
  });
});

function liveSource(data: unknown): LiveSource {
  return {
    snapshot: async () => ({ generation: 1, sequence: 0, timestamp: 0, data }),
    subscribe: () => () => {},
  };
}
