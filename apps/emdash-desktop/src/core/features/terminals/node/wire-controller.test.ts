import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { err, ok } from '@emdash/shared';
import type { LiveSource } from '@emdash/wire';
import { encodeTopic } from '@emdash/wire/api';
import { describe, expect, it, vi } from 'vitest';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import { terminalsContract } from '../api';
import type { TerminalsRuntimeBroker } from '../api/runtime-adapter';
import { createTerminalsWireController } from './wire-controller';

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: { getProject: vi.fn() },
}));

const identity = {
  projectId: 'project-1',
  workspaceId: 'workspace-1',
  host: LOCAL_HOST_REF,
  path: '/repo/worktree',
} as const;
const controllerDeps = {
  db: {} as never,
  settings: { get: vi.fn(async () => ({ defaultShell: 'default' })) } as never,
};

describe('createTerminalsWireController', () => {
  it('translates terminal ids and releases procedure leases', async () => {
    const sendInput = vi.fn(async () => ok(undefined));
    const release = vi.fn(async () => {});
    const session = vi.fn(() => ({
      ready: async () => ok({ terminals: { sendInput } }),
      release,
    }));
    const controller = createTerminalsWireController({
      ...controllerDeps,
      runtimes: { session } as unknown as TerminalsRuntimeBroker,
      workspaceIdentity: { resolve: vi.fn(async () => identity) },
    });

    await expect(
      controller.call('sendInput', {
        workspaceId: identity.workspaceId,
        terminalId: 'pty:project-1:task-1:terminal-1',
        data: 'echo ready\r',
      })
    ).resolves.toEqual(ok(undefined));

    expect(sendInput).toHaveBeenCalledWith(
      {
        key: {
          workspace: hostFileRefFromNativePath(identity.path),
          id: 'pty:project-1:task-1:terminal-1',
        },
        data: 'echo ready\r',
      },
      {}
    );
    expect(session).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it('returns RuntimeResolveError from fallible terminal procedures', async () => {
    const remoteHost = hostRef('remote', 'ssh-1');
    const resolveError = {
      type: 'host-unavailable' as const,
      host: remoteHost,
      message: 'Remote runtime sessions are not enabled',
    };
    const release = vi.fn(async () => {});
    const controller = createTerminalsWireController({
      ...controllerDeps,
      runtimes: {
        session: () => ({
          ready: async () => err(resolveError),
          release,
        }),
      } as unknown as TerminalsRuntimeBroker,
      workspaceIdentity: {
        resolve: vi.fn(async () => ({ ...identity, host: remoteHost })),
      },
    });

    await expect(
      controller.call('sendInput', {
        workspaceId: identity.workspaceId,
        terminalId: 'pty:project-1:task-1:terminal-1',
        data: 'echo ready\r',
      })
    ).resolves.toEqual(err(resolveError));
    expect(release).toHaveBeenCalledOnce();
  });

  it('holds one broker lease while output is attached', async () => {
    const source = liveSource();
    const handle = vi.fn(() => ({ asLiveSource: () => source }));
    const release = vi.fn(async () => {});
    const controller = createTerminalsWireController({
      ...controllerDeps,
      runtimes: {
        session: () => ({
          ready: async () => ok({ terminals: { output: { handle } } }),
          release,
        }),
      } as unknown as TerminalsRuntimeBroker,
      workspaceIdentity: { resolve: vi.fn(async () => identity) },
    });
    const key = {
      workspaceId: identity.workspaceId,
      terminalId: 'pty:project-1:task-1:terminal-1',
    };
    const lease = controller.acquireLive(encodeTopic(terminalsContract.output.id, key));

    const output = await lease?.ready();
    const unsubscribe = await output?.subscribe(vi.fn());
    expect(handle).toHaveBeenCalledWith({
      workspace: hostFileRefFromNativePath(identity.path),
      id: key.terminalId,
    });
    expect(release).not.toHaveBeenCalled();

    unsubscribe?.();
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    await lease?.release();
  });
});

function liveSource(): LiveSource {
  return {
    snapshot: async () => ({
      generation: 1,
      sequence: 0,
      timestamp: 0,
      data: { baseOffset: 0, text: '', truncated: false },
    }),
    subscribe: () => () => {},
  };
}
