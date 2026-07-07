import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Unsubscribe, WireTransport } from '@emdash/core/wire';
import { app, utilityProcess } from 'electron';
import { setSessionId } from '@main/core/conversations/set-session-id';
import { log } from '@main/lib/logger';
import { resolveLocalAcpSpawnContext } from '../transport/local-acp-process-host';
import type {
  AcpRuntimeChildMessage,
  AcpRuntimeControlResponse,
  AcpRuntimeHostMessage,
} from './protocol';

type RuntimeChild = ReturnType<typeof utilityProcess.fork>;

class AcpRuntimeProcessHost {
  private child: RuntimeChild | null = null;
  private readonly messageListeners = new Set<(message: unknown) => void>();
  private readonly disconnectListeners = new Set<() => void>();
  private readonly startedListeners = new Set<() => void>();

  transport(): WireTransport {
    return {
      post: (message) => {
        this.ensureStarted().postMessage(message);
      },
      onMessage: (cb): Unsubscribe => {
        this.messageListeners.add(cb);
        return () => this.messageListeners.delete(cb);
      },
      onDisconnect: (cb): Unsubscribe => {
        this.disconnectListeners.add(cb);
        return () => this.disconnectListeners.delete(cb);
      },
    };
  }

  shutdown(): void {
    const child = this.child;
    this.child = null;
    child?.postMessage({ type: 'shutdown' } satisfies AcpRuntimeHostMessage);
  }

  onStarted(cb: () => void): Unsubscribe {
    this.startedListeners.add(cb);
    if (this.child) queueMicrotask(cb);
    return () => this.startedListeners.delete(cb);
  }

  private ensureStarted(): RuntimeChild {
    if (this.child) return this.child;
    const entry = resolveRuntimeEntry();
    log.info('ACP runtime utility process entry resolved', { entry });
    const child = utilityProcess.fork(entry, [], {
      env: {
        ...process.env,
        EMDASH_ACP_ATTACHMENTS_DIR: join(app.getPath('userData'), 'acp-attachments'),
      },
      stdio: 'pipe',
    });
    child.on('error', (error) => {
      if (this.child === child) this.child = null;
      log.error('ACP runtime utility process failed', { error });
      this.notifyDisconnected();
    });
    child.on('message', (message) => {
      void this.handleMessage(message);
      this.notifyMessage(message);
    });
    child.on('exit', (code) => {
      if (this.child === child) this.child = null;
      log.warn('ACP runtime utility process exited', { code });
      this.notifyDisconnected();
    });
    child.on('spawn', () => {
      log.info('ACP runtime utility process started');
      this.notifyStarted();
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

  private notifyMessage(message: unknown): void {
    for (const listener of this.messageListeners) listener(message);
  }

  private notifyDisconnected(): void {
    for (const listener of this.disconnectListeners) listener();
  }

  private notifyStarted(): void {
    for (const listener of this.startedListeners) listener();
  }
}

export const acpRuntimeProcessHost = new AcpRuntimeProcessHost();

function isChildMessage(value: unknown): value is AcpRuntimeChildMessage {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return type === 'resolve-spawn-context' || type === 'persist-session-id' || type === 'log';
}

function resolveRuntimeEntry(): string {
  const candidates = [join(__dirname, 'acp-runtime.js'), join(__dirname, 'acp-runtime.mjs')];
  const entry = candidates.find((candidate) => existsSync(candidate));
  if (!entry) {
    throw new Error(
      `ACP runtime utility process entry is missing. Checked: ${candidates.join(', ')}`
    );
  }
  return entry;
}
