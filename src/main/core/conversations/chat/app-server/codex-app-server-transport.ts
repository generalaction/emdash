import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import { log } from '@main/lib/logger';

const DEFAULT_REQUEST_TIMEOUT_MS = 14 * 24 * 60 * 60 * 1000;
const STDERR_BUFFER_LIMIT = 8192;

type JsonRpcRequest = {
  id: number;
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  id: number;
  result?: unknown;
  error?: { message?: string };
};

type JsonRpcNotification = {
  method: string;
  params?: unknown;
};

type PendingRequest = {
  method: string;
  reject: (error: Error) => void;
  resolve: (value: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type CodexAppServerNotificationHandler = (method: string, params: unknown) => void;
export type CodexAppServerRequestHandler = (
  method: string,
  params: unknown,
  requestId: number
) => Promise<unknown> | unknown;
export type CodexAppServerExitHandler = (error: Error | undefined) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  return isRecord(value) && typeof value.id === 'number';
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return isRecord(value) && typeof value.id === 'number' && typeof value.method === 'string';
}

function isJsonRpcNotification(value: unknown): value is JsonRpcNotification {
  return isRecord(value) && value.id === undefined && typeof value.method === 'string';
}

export class CodexAppServerTransport {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly rl: readline.Interface;
  private disposed = false;
  private nextId = 1;
  private stderrBuffer = '';
  private readonly pending = new Map<number, PendingRequest>();
  private onNotification?: CodexAppServerNotificationHandler;
  private onRequest?: CodexAppServerRequestHandler;
  private onExit?: CodexAppServerExitHandler;

  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    this.rl = readline.createInterface({ input: this.child.stdout });
    this.rl.on('line', (line) => {
      void this.handleLine(line).catch((error) => {
        log.warn('CodexAppServerTransport: failed to handle stdout line', {
          error: String(error),
          line,
        });
      });
    });

    this.child.stderr.on('data', (chunk) => {
      this.stderrBuffer += chunk.toString();
      if (this.stderrBuffer.length > STDERR_BUFFER_LIMIT) {
        this.stderrBuffer = this.stderrBuffer.slice(-STDERR_BUFFER_LIMIT);
      }
    });

    this.child.on('error', (error) => this.handleExit(error));
    this.child.on('exit', (code, signal) => {
      if (this.disposed) return;
      const message =
        code === 0 && !signal
          ? 'Codex app-server exited'
          : `Codex app-server exited with code ${code ?? 'null'} and signal ${signal ?? 'null'}`;
      this.handleExit(new Error(`${message}\n${this.stderrBuffer}`.trim()));
    });
  }

  setNotificationHandler(handler: CodexAppServerNotificationHandler): void {
    this.onNotification = handler;
  }

  setRequestHandler(handler: CodexAppServerRequestHandler): void {
    this.onRequest = handler;
  }

  setExitHandler(handler: CodexAppServerExitHandler): void {
    this.onExit = handler;
  }

  request(
    method: string,
    params?: unknown,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
  ): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(new Error('Codex app-server transport is closed'));
    }

    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out for ${method}`));
      }, timeoutMs);
      this.pending.set(id, { method, reject, resolve, timer });
      try {
        this.write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.disposed) return;
    this.write({ method, params });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.rl.close();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Codex app-server transport is closed'));
    }
    this.pending.clear();
    try {
      this.child.stdin.end();
    } catch {
      // ignore shutdown write failures
    }
    if (!this.child.killed) {
      this.child.kill('SIGTERM');
    }
  }

  private write(payload: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification): void {
    if (!this.tryWrite(payload)) {
      throw new Error('Codex app-server transport is closed');
    }
  }

  private tryWrite(payload: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification): boolean {
    if (this.disposed || this.child.stdin.destroyed || this.child.stdin.writableEnded) {
      return false;
    }
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    return true;
  }

  private async handleLine(line: string): Promise<void> {
    if (!line.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      log.warn('CodexAppServerTransport: ignoring non-JSON stdout line', { line });
      return;
    }

    if (isJsonRpcResponse(parsed)) {
      const pending = this.pending.get(parsed.id);
      if (pending && (parsed.result !== undefined || parsed.error !== undefined)) {
        clearTimeout(pending.timer);
        this.pending.delete(parsed.id);
        if (parsed.error) {
          pending.reject(
            new Error(parsed.error.message ?? `Codex request failed: ${pending.method}`)
          );
        } else {
          pending.resolve(parsed.result);
        }
        return;
      }

      if (isJsonRpcRequest(parsed)) {
        await this.handleRequest(parsed);
        return;
      }
    }

    if (isJsonRpcNotification(parsed)) {
      this.onNotification?.(parsed.method, parsed.params);
    }
  }

  private async handleRequest(request: JsonRpcRequest): Promise<void> {
    try {
      const result = this.onRequest
        ? await this.onRequest(request.method, request.params, request.id)
        : {};
      this.tryWrite({ id: request.id, result });
    } catch (error) {
      this.tryWrite({
        id: request.id,
        error: { message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  private handleExit(error: Error | undefined): void {
    if (this.disposed && !error) return;
    this.disposed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error ?? new Error('Codex app-server exited'));
    }
    this.pending.clear();
    this.onExit?.(error);
  }
}
