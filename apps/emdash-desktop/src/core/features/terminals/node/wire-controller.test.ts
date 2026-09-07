import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { err, ok } from '@emdash/shared';
import type { LiveSource } from '@emdash/wire/rpc';
import { encodeTopic } from '@emdash/wire/rpc';
import { describe, expect, it, vi } from 'vitest';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import { terminalsContract } from '../api';
import type { TerminalsRuntimeBroker } from '../api/runtime-adapter';
import { createTerminalsWireController } from './wire-controller';

const identity = {
  projectId: 'project-1',
  workspaceId: 'workspace-1',
  host: LOCAL_HOST_REF,
  path: '/repo/worktree',
} as const;
const controllerDeps = {
  db: {} as never,
  logger: { warn: vi.fn() } as never,
  projects: { requireAttached: vi.fn(() => ok({} as never)) },
  settings: { get: vi.fn(async () => ({ defaultShell: 'default' })) } as never,
  telemetry: { capture: vi.fn() } as never,
  terminalShell: {
    getColorEnv: vi.fn(async () => ({})),
  } as never,
  sessionLaunchContexts: {
    resolve: vi.fn(async () =>
      ok({
        workspace: identity,
        tmux: false,
        env: {},
      })
    ),
  },
  resolveSessionGitCredentials: vi.fn(async () => undefined),
};

describe('createTerminalsWireController', () => {
  it('translates terminal ids through the resolved client', async () => {
    const sendInput = vi.fn(async () => ok(undefined));
    const client = vi.fn(async () => ok({ terminals: { sendInput } }));
    const controller = createTerminalsWireController({
      ...controllerDeps,
      runtimes: { client } as unknown as TerminalsRuntimeBroker,
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
    expect(client).toHaveBeenCalledOnce();
  });

  it('returns RuntimeResolveError from fallible terminal procedures', async () => {
    const remoteHost = hostRef('remote', 'ssh-1');
    const resolveError = {
      type: 'host-unavailable' as const,
      host: remoteHost,
      reason: 'runtime-unavailable' as const,
      message: 'Remote runtime sessions are not enabled',
    };
    const controller = createTerminalsWireController({
      ...controllerDeps,
      runtimes: {
        client: async () => err(resolveError),
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
  });

  it('resolves shell availability against the requested host runtime', async () => {
    const availability = [
      { id: 'system' as const, label: 'zsh', isSystemDefault: true, available: true },
    ];
    const getShellAvailability = vi.fn(async () => ok(availability));
    const remoteHost = hostRef('remote', 'ssh-1');
    const client = vi.fn(async () => ok({ terminals: { getShellAvailability } }));
    const controller = createTerminalsWireController({
      ...controllerDeps,
      runtimes: { client } as unknown as TerminalsRuntimeBroker,
      workspaceIdentity: { resolve: vi.fn() },
    });

    await expect(controller.call('getShellAvailability', { host: remoteHost })).resolves.toEqual(
      ok(availability)
    );
    expect(client).toHaveBeenCalledWith(remoteHost);
    expect(getShellAvailability).toHaveBeenCalledWith(undefined);
  });

  it('surfaces RuntimeResolveError when the availability host is unreachable', async () => {
    const remoteHost = hostRef('remote', 'ssh-1');
    const resolveError = {
      type: 'host-unavailable' as const,
      host: remoteHost,
      reason: 'runtime-unavailable' as const,
      message: 'Remote runtime sessions are not enabled',
    };
    const controller = createTerminalsWireController({
      ...controllerDeps,
      runtimes: {
        client: async () => err(resolveError),
      } as unknown as TerminalsRuntimeBroker,
      workspaceIdentity: { resolve: vi.fn() },
    });

    await expect(controller.call('getShellAvailability', { host: remoteHost })).resolves.toEqual(
      err(resolveError)
    );
  });

  it('starts terminals with registry shell setup and DB placement tmux', async () => {
    const terminalRow = {
      id: 'terminal-1',
      projectId: identity.projectId,
      taskId: 'task-1',
      name: 'Terminal',
      shellId: 'default',
      ssh: 0,
    };
    const select = vi.fn().mockReturnValueOnce(selecting(terminalRow));
    const resolveLaunchContext = vi.fn(async () =>
      ok({
        workspace: identity,
        tmux: true,
        shellSetup: 'source .workspace-env',
        env: { EMDASH_DEFAULT_BRANCH: 'main' },
      })
    );
    const start = vi.fn(async () => ok(undefined));
    const runtime = {
      terminals: { start },
    };
    const requireAttached = vi.fn(() => ok({} as never));
    const controller = createTerminalsWireController({
      ...controllerDeps,
      db: { select } as never,
      projects: { requireAttached } as never,
      sessionLaunchContexts: { resolve: resolveLaunchContext },
      runtimes: {
        client: vi.fn(async () => ok(runtime)),
      } as unknown as TerminalsRuntimeBroker,
      workspaceIdentity: { resolve: vi.fn(async () => identity) },
    });

    await expect(
      controller.call('hydrate', {
        projectId: identity.projectId,
        taskId: terminalRow.taskId,
        terminalId: terminalRow.id,
      })
    ).resolves.toEqual(
      ok({
        key: {
          workspaceId: identity.workspaceId,
          terminalId: `${identity.projectId}:${terminalRow.taskId}:${terminalRow.id}`,
        },
      })
    );
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        spec: expect.objectContaining({
          shellSetup: 'source .workspace-env',
          tmux: true,
          env: expect.objectContaining({ EMDASH_DEFAULT_BRANCH: 'main' }),
        }),
      })
    );
    expect(resolveLaunchContext).toHaveBeenCalledWith({
      projectId: identity.projectId,
      taskId: terminalRow.taskId,
    });
    expect(requireAttached).toHaveBeenCalledWith(identity.projectId);
  });

  it('resolves the output source for the workspace host', async () => {
    const source = liveSource();
    const handle = vi.fn(() => ({ asLiveSource: () => source }));
    const controller = createTerminalsWireController({
      ...controllerDeps,
      runtimes: {
        client: async () => ok({ terminals: { output: { handle } } }),
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

    unsubscribe?.();
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

function selecting<T>(row: T) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => [row],
      }),
    }),
  };
}
