import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { recordSpawn } from '@emdash/shared/perf';
import {
  CancellationTokenSource,
  createProtocolConnection,
} from 'vscode-languageserver-protocol/node.js';
import { z } from 'zod';
import {
  createChildProcessTreeTerminator,
  planExecutableLaunch,
  toChildProcessLaunch,
} from '#primitives/exec/node';
import type { LanguageServerTransport } from './server-session';

export interface LanguageServerLaunch {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  initializationOptions?: unknown;
}

/** Owns stdio framing, bounded RPCs, server requests and the entire child tree. */
export async function spawnLanguageServer(
  options: LanguageServerLaunch
): Promise<LanguageServerTransport> {
  const plan = planExecutableLaunch({ platform: process.platform, ...options });
  const launch = toChildProcessLaunch(plan.invocation);
  recordSpawn('other', launch.executable);
  const child = spawn(launch.executable, launch.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
    windowsVerbatimArguments: launch.windowsVerbatimArguments,
  });
  const terminator = createChildProcessTreeTerminator(child, {
    processGroup: process.platform !== 'win32',
  });
  const lifetime = new AbortController();
  const notifications = new Set<(method: string, params: unknown) => void>();
  const closes = new Set<() => void>();
  const close = () => {
    if (lifetime.signal.aborted) return;
    lifetime.abort(new Error('Language server disconnected'));
    for (const listener of closes) listener();
  };
  child.on('error', close);
  child.on('exit', close);
  // Always drain stderr. Protocol payloads and project content never enter logs.
  child.stderr.resume();
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
  } catch (error) {
    await terminator.terminate();
    throw error;
  }
  const connection = createProtocolConnection(child.stdout, child.stdin);
  connection.onClose(close);
  connection.onNotification('textDocument/publishDiagnostics', (params: unknown) => {
    for (const listener of notifications) listener('textDocument/publishDiagnostics', params);
  });
  connection.onRequest('workspace/configuration', (input: unknown) => {
    const parsed = z
      .object({ items: z.array(z.object({ section: z.string().optional() })) })
      .safeParse(input);
    return parsed.success
      ? parsed.data.items.map((item) =>
          item.section === 'formattingOptions' ? { tabSize: 2, insertSpaces: true } : null
        )
      : [];
  });
  connection.onRequest('workspace/workspaceFolders', () => [
    { uri: pathToFileURL(options.cwd).href, name: 'workspace' },
  ]);
  connection.onRequest('workspace/applyEdit', () => ({
    applied: false,
    failureReason: 'Workspace edits are not supported by this client.',
  }));
  connection.onRequest('window/workDoneProgress/create', () => null);
  connection.onRequest('window/showMessageRequest', () => null);
  connection.listen();
  let disposal: Promise<void> | undefined;

  return {
    initializationOptions: options.initializationOptions,
    async request(method, params, signal) {
      const timeout = AbortSignal.timeout(options.requestTimeoutMs ?? 15_000);
      const combined = AbortSignal.any([lifetime.signal, timeout, ...(signal ? [signal] : [])]);
      combined.throwIfAborted();
      const cancellation = new CancellationTokenSource();
      let abort: () => void = () => {};
      const cancelled = new Promise<never>((_resolve, reject) => {
        abort = () => {
          cancellation.cancel();
          reject(
            timeout.aborted
              ? new Error(`Language server request timed out: ${method}`)
              : combined.reason
          );
        };
        combined.addEventListener('abort', abort, { once: true });
      });
      try {
        return await Promise.race([
          connection.sendRequest<unknown>(method, params, cancellation.token),
          cancelled,
        ]);
      } finally {
        combined.removeEventListener('abort', abort);
        cancellation.dispose();
      }
    },
    async notify(method, params) {
      lifetime.signal.throwIfAborted();
      await connection.sendNotification(method, params);
    },
    onNotification(listener) {
      notifications.add(listener);
      return () => notifications.delete(listener);
    },
    onClose(listener) {
      closes.add(listener);
      if (lifetime.signal.aborted)
        queueMicrotask(() => {
          if (closes.has(listener)) listener();
        });
      return () => closes.delete(listener);
    },
    dispose() {
      return (disposal ??= (async () => {
        notifications.clear();
        closes.clear();
        close();
        connection.dispose();
        await terminator.terminate();
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
      })());
    },
  };
}
