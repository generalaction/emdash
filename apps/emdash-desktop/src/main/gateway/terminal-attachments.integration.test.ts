import { mkdtemp, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  hostRef,
  hostRefEquals,
  LOCAL_HOST_REF,
  type HostRef,
} from '@emdash/core/primitives/host/api';
import { filesContract } from '@emdash/core/runtimes/files/api';
import { createFilesController, FilesRuntime } from '@emdash/core/runtimes/files/node';
import type { IWatchService } from '@emdash/core/services/fs-watch/api';
import { ok } from '@emdash/shared';
import { noopLogger } from '@emdash/shared/logger';
import { client, connect, memoryTransportPair, serve } from '@emdash/wire/rpc';
import { describe, expect, it, vi } from 'vitest';
import { terminalsContract } from '@core/features/terminals/api';
import type { TerminalsRuntimeBroker } from '@core/features/terminals/api/runtime-adapter';
import { createTerminalsWireController } from '@core/features/terminals/node/wire-controller';

const remoteHost = hostRef('remote', 'attachment-integration-target');
const identity = {
  projectId: 'project-1',
  workspaceId: 'workspace-1',
  host: remoteHost,
  path: '/remote/worktree',
} as const;

describe('terminal attachment preparation across files runtimes', () => {
  it('streams exact local bytes into a durable target temporary upload', async () => {
    const worktree = await realpath(
      await mkdtemp(path.join(tmpdir(), 'emdash-attachment-integration-worktree-'))
    );
    const localPath = path.join(worktree, 'binary-fixture.bin');
    const fixtureBytes = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x0a, 0x42, 0x7f]);
    await writeFile(localPath, fixtureBytes);

    const localRuntime = new FilesRuntime({ watcher: noopWatcher(), idleTtlMs: 0 });
    const targetRuntime = new FilesRuntime({ watcher: noopWatcher(), idleTtlMs: 0 });
    const localEndpoint = serveFilesRuntime(localRuntime);
    const targetEndpoint = serveFilesRuntime(targetRuntime);
    let uploadedPath: string | undefined;
    let runtimesDisposed = false;

    const disposeRuntimes = async () => {
      await localEndpoint.dispose();
      await targetEndpoint.dispose();
      await localRuntime.dispose();
      await targetRuntime.dispose();
      runtimesDisposed = true;
    };

    try {
      const runtimes = {
        client: async (host: HostRef) => {
          if (hostRefEquals(host, LOCAL_HOST_REF)) return ok(localEndpoint.hostClient);
          if (hostRefEquals(host, remoteHost)) return ok(targetEndpoint.hostClient);
          throw new Error(`Unexpected runtime host: ${JSON.stringify(host)}`);
        },
      } as unknown as TerminalsRuntimeBroker;
      const requireAttached = vi.fn(() => ok({} as never));
      // Attachment dispatch does not exercise the controller's other domain dependencies.
      const controller = createTerminalsWireController({
        db: {} as never,
        logger: noopLogger,
        projects: { requireAttached },
        runtimes,
        sessionLaunchContexts: { resolve: vi.fn() },
        settings: { get: vi.fn() } as never,
        workspaceIdentity: { resolve: async () => identity },
        telemetry: { capture: vi.fn() } as never,
        terminalShell: { getColorEnv: vi.fn() },
        resolveSessionGitCredentials: vi.fn(),
      });

      const result = terminalsContract.prepareAttachments.output.parse(
        await controller.call('prepareAttachments', {
          workspaceId: identity.workspaceId,
          expectedHost: remoteHost,
          localPaths: [localPath],
        })
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error(`Attachment transfer failed: ${result.error.type}`);
      expect(result.data.paths).toHaveLength(1);
      expect(result.data.pathStyle).toBe(path.sep === '\\' ? 'win32' : 'posix');
      uploadedPath = result.data.paths[0];

      expect(path.relative(worktree, uploadedPath)).toMatch(/^\.\.(?:[\\/]|$)/u);
      await expect(readFile(uploadedPath)).resolves.toEqual(fixtureBytes);
      expect(requireAttached).toHaveBeenCalledWith(identity.projectId);

      await disposeRuntimes();

      await expect(readFile(uploadedPath)).resolves.toEqual(fixtureBytes);
      await unlink(uploadedPath);
      uploadedPath = undefined;
    } finally {
      if (!runtimesDisposed) await disposeRuntimes();
      if (uploadedPath) await unlink(uploadedPath).catch(() => undefined);
      await rm(worktree, { recursive: true, force: true });
    }
  });
});

function serveFilesRuntime(runtime: FilesRuntime) {
  const pair = memoryTransportPair();
  const controller = createFilesController(runtime);
  const connection = connect(pair.left);
  const stop = serve(pair.right, controller);
  const files = client(filesContract, connection);
  const hostClient = { files };
  let disposed = false;

  return {
    hostClient,
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      stop();
      await controller.dispose?.();
      connection.dispose();
    },
  };
}

function noopWatcher(): IWatchService {
  return {
    watch: () => ({ ready: async () => ok(undefined), release: async () => {} }),
    dispose: async () => {},
  };
}
