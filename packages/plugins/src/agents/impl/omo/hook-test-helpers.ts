import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLocalPluginFs } from '@emdash/core/services/agent-plugins/api/plugins/helpers';
import { provider } from './index';

type SessionEntry = { id: string; type: string; customType?: string };
type HookContext = {
  sessionManager: {
    getSessionFile(): string | undefined;
    getEntries(): readonly SessionEntry[];
  };
};
type HookEvent = {
  messages?: readonly { role: string; stopReason?: string; errorMessage?: string }[];
  aborted?: boolean;
  abortSource?: 'user' | 'system' | 'provider';
  willRetry?: boolean;
  fallbackExhausted?: { resumeAt?: number };
  reason?: string;
};
type Callback = (event: HookEvent, ctx: HookContext) => void | Promise<void>;
export type ExtensionApi = {
  on(event: string, callback: Callback): void;
  registerFlag(name: string, options: { type: 'string' }): void;
  getFlag(name: string): string | undefined;
  sendUserMessage(content: string): void;
};
export type HookRequest = {
  readonly headers: IncomingHttpHeaders;
  readonly body: unknown;
  readonly url: string | undefined;
};

export async function installedExtension() {
  const root = await mkdtemp(join(tmpdir(), 'omo-hook-'));
  const fs = createLocalPluginFs(root);
  const plugins = provider.behavior.plugins;
  if (!plugins) throw new Error('OmO plugin behavior missing');
  await plugins.installPlugin(fs, { kind: 'global' });
  return {
    root,
    fs,
    plugins,
    moduleUrl: pathToFileURL(join(root, 'extensions/emdash-hook.js')).href,
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}

export function callbacks(load: (api: ExtensionApi) => void, initialPrompt?: string) {
  const handlers = new Map<string, Callback>();
  const flags = new Set<string>();
  const messages: string[] = [];
  let sessionFile: string | undefined = '/sessions/first session.jsonl';
  let entries: readonly SessionEntry[] = [];
  load({
    registerFlag(name) {
      flags.add(name);
    },
    getFlag(name) {
      return flags.has(name) && name === 'emdash-initial-prompt' ? initialPrompt : undefined;
    },
    sendUserMessage(content) {
      messages.push(content);
    },
    on(event, callback) {
      if (handlers.has(event)) throw new Error('Duplicate handler: ' + event);
      handlers.set(event, callback);
    },
  });
  return {
    handlers,
    messages,
    setSessionFile(value: string | undefined) {
      sessionFile = value;
    },
    setEntries(value: readonly SessionEntry[]) {
      entries = value;
    },
    async emit(name: string, event: HookEvent = {}) {
      await handlers.get(name)?.(event, {
        sessionManager: { getSessionFile: () => sessionFile, getEntries: () => entries },
      });
    },
  };
}

export async function hookServer(options: { holdResponse?: boolean } = {}) {
  const requests: HookRequest[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const received = {
      headers: req.headers,
      body: JSON.parse(Buffer.concat(chunks).toString()),
      url: req.url,
    };
    requests.push(received);
    if (!options.holdResponse) res.end('{}');
    server.emit('hook', received);
  });
  const listening = once(server, 'listening', { signal: AbortSignal.timeout(2000) });
  server.listen(0, '127.0.0.1');
  await listening;
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('TCP server missing address');
  return {
    port: String(address.port),
    requests,
    next: () => once(server, 'hook', { signal: AbortSignal.timeout(2000) }),
    async dispose() {
      const closed = once(server, 'close', { signal: AbortSignal.timeout(2000) });
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}
