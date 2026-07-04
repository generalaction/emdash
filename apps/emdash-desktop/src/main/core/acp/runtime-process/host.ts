import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MessageChannelMain, utilityProcess, type MessagePortMain, type WebContents } from 'electron';
import { AcpRuntime, createAcpRouter, serveAcpPort, type AcpRouter } from '@emdash/core/acp';
import { pluginRegistry } from '@emdash/plugins/agents';
import { setSessionId } from '@main/core/conversations/set-session-id';
import { log } from '@main/lib/logger';
import { LocalAcpProcessHost, resolveLocalAcpSpawnContext } from '../transport/local-acp-process-host';
import type {
  AcpRuntimeChildMessage,
  AcpRuntimeControlResponse,
  AcpRuntimeHostMessage,
} from './protocol';

type RuntimeChild = ReturnType<typeof utilityProcess.fork>;

class AcpRuntimeProcessHost {
  private child: RuntimeChild | null = null;
  private fallbackRouter: AcpRouter | null = null;

  requestRuntimePort(webContents: WebContents): string {
    const requestId = crypto.randomUUID();
    const { port1, port2 } = new MessageChannelMain();
    const child = this.ensureStarted();
    if (child) {
      child.postMessage({ type: 'client-port' } satisfies AcpRuntimeHostMessage, [port1]);
    } else {
      serveAcpPort(this.ensureFallbackRouter(), port1);
    }
    webContents.postMessage('acp:runtime-port', { requestId }, [port2]);
    return requestId;
  }

  shutdown(): void {
    const child = this.child;
    this.child = null;
    child?.postMessage({ type: 'shutdown' } satisfies AcpRuntimeHostMessage);
  }

  private ensureStarted(): RuntimeChild | null {
    if (this.child) return this.child;
    const entry = resolveRuntimeEntry();
    if (!entry) return null;
    log.info('ACP runtime utility process entry resolved', { entry });
    const child = utilityProcess.fork(entry, [], {
      stdio: 'pipe',
    });
    child.on('error', (error) => {
      if (this.child === child) this.child = null;
      log.error('ACP runtime utility process failed', { error });
    });
    child.on('message', (message) => {
      void this.handleMessage(unwrapMessage(message));
    });
    child.on('exit', (code) => {
      if (this.child === child) this.child = null;
      log.warn('ACP runtime utility process exited', { code });
    });
    child.on('spawn', () => {
      log.info('ACP runtime utility process started');
    });
    child.stdout?.on('data', (chunk) => {
      log.debug('ACP runtime stdout', { chunk: String(chunk) });
    });
    child.stderr?.on('data', (chunk) => {
      log.warn('ACP runtime stderr', { chunk: String(chunk) });
    });
    this.child = child;
    return child;
  }

  private ensureFallbackRouter(): AcpRouter {
    if (this.fallbackRouter) return this.fallbackRouter;
    log.warn('ACP runtime utility process entry missing; serving ACP runtime in main process');
    const runtime = new AcpRuntime({
      resolveAcp: (providerId) => {
        const plugin = pluginRegistry.get(providerId);
        if (!plugin || plugin.capabilities.acp.kind !== 'supported' || !plugin.behavior.acp) {
          return null;
        }
        return { behavior: plugin.behavior.acp };
      },
      host: new LocalAcpProcessHost(),
      persistSessionId: setSessionId,
      resolveAttachment: async (attachment) => {
        const data = await readFile(attachment.originalPath);
        return {
          data: data.toString('base64'),
          mimeType: attachment.mimeType,
        };
      },
      logger: log.child({ source: 'acp-runtime-main-fallback' }),
    });
    this.fallbackRouter = createAcpRouter(runtime);
    return this.fallbackRouter;
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isChildMessage(message)) return;
    switch (message.type) {
      case 'resolve-spawn-context':
        await this.resolveSpawnContext(message.requestId, message.providerId);
        break;
      case 'persist-session-id':
        await this.persistSessionId(message.conversationId, message.sessionId);
        break;
      case 'log':
        log[message.level](message.message, { source: 'acp-runtime', data: message.data });
        break;
    }
  }

  private async resolveSpawnContext(requestId: string, providerId: string): Promise<void> {
    try {
      const value = await resolveLocalAcpSpawnContext(providerId);
      this.post({
        type: 'resolve-spawn-context-result',
        requestId,
        ok: true,
        value,
      });
    } catch (error) {
      this.post({
        type: 'resolve-spawn-context-result',
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async persistSessionId(conversationId: string, sessionId: string): Promise<void> {
    const result = await setSessionId(conversationId, sessionId);
    if (!result.success) {
      log.warn('ACP runtime failed to persist session id', {
        conversationId,
        error: result.error,
      });
    }
  }

  private post(message: AcpRuntimeControlResponse): void {
    this.child?.postMessage(message);
  }
}

export const acpRuntimeProcessHost = new AcpRuntimeProcessHost();

function isChildMessage(value: unknown): value is AcpRuntimeChildMessage {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return type === 'resolve-spawn-context' || type === 'persist-session-id' || type === 'log';
}

function unwrapMessage(value: unknown): unknown {
  if (typeof value === 'object' && value !== null && 'data' in value) {
    return (value as { data: unknown }).data;
  }
  return value;
}

function resolveRuntimeEntry(): string | null {
  const candidates = [join(__dirname, 'acp-runtime.js'), join(__dirname, 'acp-runtime.mjs')];
  const entry = candidates.find((candidate) => existsSync(candidate));
  if (!entry) log.warn('ACP runtime utility process entry is missing', { candidates });
  return entry ?? null;
}

export type { MessagePortMain };
