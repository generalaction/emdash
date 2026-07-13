import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Unsubscribe } from '@emdash/shared';
import { client, connect, defineContract, isWireMessage, type WireTransport } from '@emdash/wire';
import {
  RUNTIME_SHUTDOWN_SIGNAL,
  isWorkerSignal,
  type WorkerParentPort,
} from '@emdash/wire/worker';
import { filesContract } from '@runtimes/files/api';
import { relativePath, runtimeRoot } from '@runtimes/files/node/testing/paths';
import { describe, expect, it } from 'vitest';
import { bootFilesRuntimeProcess } from './boot';

describe('bootFilesRuntimeProcess', () => {
  it('serves a nested files contract and disposes on runtime shutdown', async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'emdash-files-process-')));
    await writeFile(path.join(root, 'file.txt'), 'process');
    const ports = linkedPorts();
    const parentContract = defineContract({ files: filesContract });
    const ready = waitForMessage(ports.parent, (message) => isRuntimeSignal(message, 'ready'));
    let exitCode: number | undefined;
    let shutdownSent = false;
    const exited = new Promise<void>((resolve) => {
      bootFilesRuntimeProcess({
        contract: parentContract.files,
        env: { NODE_ENV: 'test' },
        port: ports.child,
        exit: (code) => {
          exitCode = code;
          resolve();
        },
      });
    });

    try {
      await ready;
      const api = client(parentContract.files, connect(portTransport(ports.parent)));
      await expect(
        api.fs.readText({ root: runtimeRoot(root), relative: relativePath('file.txt') })
      ).resolves.toMatchObject({
        success: true,
        data: { content: 'process' },
      });

      ports.parent.send(RUNTIME_SHUTDOWN_SIGNAL);
      shutdownSent = true;
      await exited;
      expect(exitCode).toBe(0);
    } finally {
      if (!shutdownSent) ports.parent.send(RUNTIME_SHUTDOWN_SIGNAL);
      await exited;
      await rm(root, { recursive: true, force: true });
    }
  });
});

function linkedPorts(): { parent: TestPort; child: TestPort } {
  const parent = new TestPort();
  const child = new TestPort();
  parent.peer = child;
  child.peer = parent;
  return { parent, child };
}

class TestPort implements WorkerParentPort {
  peer?: TestPort;
  private readonly messageListeners = new Set<(message: unknown) => void>();
  private readonly disconnectListeners = new Set<() => void>();

  send(message: unknown): void {
    queueMicrotask(() => {
      for (const listener of this.peer?.messageListeners ?? []) listener(message);
    });
  }

  onMessage(cb: (message: unknown) => void): Unsubscribe {
    this.messageListeners.add(cb);
    return () => this.messageListeners.delete(cb);
  }

  onDisconnect(cb: () => void): Unsubscribe {
    this.disconnectListeners.add(cb);
    return () => this.disconnectListeners.delete(cb);
  }
}

function portTransport(port: WorkerParentPort): WireTransport {
  return {
    post: (message) => port.send(message),
    onMessage: (cb) => port.onMessage((message) => isWireMessage(message) && cb(message)),
    onDisconnect: (cb) => port.onDisconnect(cb),
  };
}

function waitForMessage(
  port: WorkerParentPort,
  predicate: (message: unknown) => boolean
): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = port.onMessage((message) => {
      if (!predicate(message)) return;
      unsubscribe();
      resolve();
    });
  });
}

function isRuntimeSignal(message: unknown, event: string): boolean {
  return event === 'ready' && isWorkerSignal(message, 'ready');
}
