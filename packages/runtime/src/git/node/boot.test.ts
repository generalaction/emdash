import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { gitContract } from '@emdash/core/git';
import type { Unsubscribe } from '@emdash/shared';
import { client, connect, defineContract, isWireMessage, type WireTransport } from '@emdash/wire';
import {
  RUNTIME_SHUTDOWN_SIGNAL,
  type ProcessRuntimePort,
} from '@emdash/wire/util/process-runtime';
import { describe, expect, it } from 'vitest';
import { hostPath } from '../testing/paths';
import { bootGitRuntimeProcess } from './boot';

const execFileAsync = promisify(execFile);

describe('bootGitRuntimeProcess', () => {
  it('serves a nested Git contract and disposes on runtime shutdown', async () => {
    const repo = await realpath(await mkdtemp(path.join(tmpdir(), 'emdash-git-process-')));
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
    await writeFile(path.join(repo, 'file.txt'), 'process\n');
    await execFileAsync('git', ['add', 'file.txt'], { cwd: repo });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repo });

    const ports = linkedPorts();
    const parentContract = defineContract({ git: gitContract });
    const ready = waitForMessage(ports.parent, (message) => isRuntimeSignal(message, 'ready'));
    let exitCode: number | undefined;
    let shutdownSent = false;
    const exited = new Promise<void>((resolve) => {
      bootGitRuntimeProcess({
        contract: parentContract.git,
        env: { ...process.env, NODE_ENV: 'test' },
        port: ports.child,
        exit: (code) => {
          exitCode = code;
          resolve();
        },
      });
    });

    try {
      await ready;
      const api = client(parentContract.git, connect(portTransport(ports.parent)));
      await expect(api.inspectPath({ path: hostPath(repo) })).resolves.toMatchObject({
        kind: 'repository',
        rootPath: hostPath(repo),
      });

      ports.parent.send(RUNTIME_SHUTDOWN_SIGNAL);
      shutdownSent = true;
      await exited;
      expect(exitCode).toBe(0);
    } finally {
      if (!shutdownSent) ports.parent.send(RUNTIME_SHUTDOWN_SIGNAL);
      await exited;
      await rm(repo, { recursive: true, force: true });
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

class TestPort implements ProcessRuntimePort {
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

function portTransport(port: ProcessRuntimePort): WireTransport {
  return {
    post: (message) => port.send(message),
    onMessage: (cb) => port.onMessage((message) => isWireMessage(message) && cb(message)),
    onDisconnect: (cb) => port.onDisconnect(cb),
  };
}

function waitForMessage(
  port: ProcessRuntimePort,
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
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { kind?: unknown }).kind === 'wire-runtime-signal' &&
    (message as { event?: unknown }).event === event
  );
}
