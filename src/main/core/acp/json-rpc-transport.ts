import type { Readable, Writable } from 'node:stream';
import { AcpDiagnosticsBuffer } from './diagnostics';
import {
  formatJsonRpcError,
  parseJsonRpcMessage,
  safeJsonStringify,
  type JsonRpcFailure,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonValue,
} from './types';

type PendingRequest = {
  method: string;
  resolve: (value: JsonValue) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export type AcpJsonRpcTransportOptions = {
  stdout: Readable;
  stdin: Writable;
  stderr?: Readable;
  diagnostics?: AcpDiagnosticsBuffer;
};

export class AcpJsonRpcTransport {
  private nextId = 0;
  private stdoutBuffer = '';
  private pending = new Map<JsonRpcId, PendingRequest>();
  private notificationHandlers = new Set<(notification: JsonRpcNotification) => void>();
  private requestHandlers = new Set<(request: JsonRpcRequest) => void>();
  private started = false;
  readonly diagnostics: AcpDiagnosticsBuffer;

  constructor(private readonly options: AcpJsonRpcTransportOptions) {
    this.diagnostics = options.diagnostics ?? new AcpDiagnosticsBuffer();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.options.stdout.setEncoding('utf8');
    this.options.stdout.on('data', this.handleStdoutData);
    this.options.stdout.on('error', this.handleStdoutError);
    this.options.stdout.on('end', this.handleStdoutEnd);

    if (this.options.stderr) {
      this.options.stderr.setEncoding('utf8');
      this.options.stderr.on('data', this.handleStderrData);
    }
  }

  onNotification(handler: (notification: JsonRpcNotification) => void): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  onRequest(handler: (request: JsonRpcRequest) => void): () => void {
    this.requestHandlers.add(handler);
    return () => this.requestHandlers.delete(handler);
  }

  request<T extends JsonValue = JsonValue>(
    method: string,
    params?: JsonValue,
    options: { timeoutMs?: number } = {}
  ): Promise<T> {
    const id = this.nextId++;
    const timeoutMs = options.timeoutMs ?? 15_000;
    const message = {
      jsonrpc: '2.0' as const,
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACP request timed out: ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });

      this.writeMessage(message);
    });
  }

  notify(method: string, params?: JsonValue): void {
    this.writeMessage({
      jsonrpc: '2.0',
      method,
      ...(params === undefined ? {} : { params }),
    });
  }

  respond(id: JsonRpcId, result: JsonValue): void {
    this.writeMessage({ jsonrpc: '2.0', id, result });
  }

  respondError(id: JsonRpcId, error: JsonRpcFailure['error']): void {
    this.writeMessage({ jsonrpc: '2.0', id, error });
  }

  dispose(): void {
    this.rejectAll(new Error('ACP transport disposed'));
    this.options.stdout.off('data', this.handleStdoutData);
    this.options.stdout.off('error', this.handleStdoutError);
    this.options.stdout.off('end', this.handleStdoutEnd);
    this.options.stderr?.off('data', this.handleStderrData);
    this.started = false;
  }

  private writeMessage(message: JsonRpcMessage): void {
    this.options.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newlineIndex = this.stdoutBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex);
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      this.handleLine(line);
      newlineIndex = this.stdoutBuffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      this.diagnostics.append('stdout', `Malformed ACP JSON line: ${trimmed}`);
      return;
    }

    const message = parseJsonRpcMessage(parsed);
    if (!message) {
      this.diagnostics.append(
        'stdout',
        `Invalid ACP JSON-RPC message: ${safeJsonStringify(parsed)}`
      );
      return;
    }

    this.routeMessage(message);
  }

  private routeMessage(message: JsonRpcMessage): void {
    if ('id' in message && ('result' in message || 'error' in message)) {
      if (message.id === null) {
        this.diagnostics.append('transport', 'ACP error response did not include a request id');
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) {
        this.diagnostics.append('transport', `Unexpected ACP response id: ${String(message.id)}`);
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if ('error' in message) {
        pending.reject(
          new Error(`ACP ${pending.method} failed: ${formatJsonRpcError(message.error)}`)
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if ('id' in message) {
      for (const handler of this.requestHandlers) handler(message);
      return;
    }

    for (const handler of this.notificationHandlers) handler(message);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private handleStdoutData = (chunk: string): void => {
    this.handleStdout(chunk);
  };

  private handleStdoutError = (error: Error): void => {
    this.rejectAll(error);
  };

  private handleStdoutEnd = (): void => {
    this.rejectAll(new Error('ACP stdout closed'));
  };

  private handleStderrData = (chunk: string): void => {
    this.diagnostics.append('stderr', chunk);
  };
}
