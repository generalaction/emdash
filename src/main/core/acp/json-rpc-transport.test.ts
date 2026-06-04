import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { initializeAcpConnection } from './client';
import { AcpDiagnosticsBuffer } from './diagnostics';
import { AcpJsonRpcTransport } from './json-rpc-transport';
import type { JsonObject } from './types';

function makeTransport(maxDiagnosticChars?: number): {
  transport: AcpJsonRpcTransport;
  stdout: PassThrough;
  stdin: PassThrough;
  stderr: PassThrough;
  writes: string[];
} {
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  const stderr = new PassThrough();
  const writes: string[] = [];
  stdin.setEncoding('utf8');
  stdin.on('data', (chunk: string) => writes.push(chunk));
  const transport = new AcpJsonRpcTransport({
    stdout,
    stdin,
    stderr,
    diagnostics: new AcpDiagnosticsBuffer(maxDiagnosticChars),
  });
  transport.start();
  return { transport, stdout, stdin, stderr, writes };
}

function writeMessage(stdout: PassThrough, message: JsonObject): void {
  stdout.write(`${JSON.stringify(message)}\n`);
}

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('AcpJsonRpcTransport', () => {
  it('writes newline-framed JSON-RPC requests and resolves responses', async () => {
    const { transport, stdout, writes } = makeTransport();
    const promise = transport.request('initialize', { protocolVersion: 1 });

    await tick();
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0])).toMatchObject({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: 1 },
    });
    expect(writes[0].endsWith('\n')).toBe(true);

    writeMessage(stdout, { jsonrpc: '2.0', id: 0, result: { ok: true } });
    await expect(promise).resolves.toEqual({ ok: true });
  });

  it('routes notifications split across stdout chunks', async () => {
    const { transport, stdout } = makeTransport();
    const notifications: JsonObject[] = [];
    transport.onNotification((notification) => notifications.push(notification as JsonObject));

    stdout.write('{"jsonrpc":"2.0","method":"session/update","params":');
    stdout.write('{"sessionId":"s1"}}\n');

    await tick();
    expect(notifications).toEqual([
      {
        jsonrpc: '2.0',
        method: 'session/update',
        params: { sessionId: 's1' },
      },
    ]);
  });

  it('records malformed stdout as bounded diagnostics without rejecting valid later messages', async () => {
    const { transport, stdout } = makeTransport();
    const notifications: JsonObject[] = [];
    transport.onNotification((notification) => notifications.push(notification as JsonObject));

    stdout.write('not-json\n');
    writeMessage(stdout, { jsonrpc: '2.0', method: 'session/update' });

    await tick();
    expect(transport.diagnostics.summary()).toContain('Malformed ACP JSON line');
    expect(notifications).toHaveLength(1);
  });

  it('formats JSON-RPC error responses without object stringification noise', async () => {
    const { transport, stdout } = makeTransport();
    const promise = transport.request('session/new', {});
    writeMessage(stdout, {
      jsonrpc: '2.0',
      id: 0,
      error: {
        code: -32000,
        message: 'No workspace',
        data: { reason: 'missing cwd' },
      },
    });

    await expect(promise).rejects.toThrow(
      'ACP session/new failed: -32000: No workspace {"reason":"missing cwd"}'
    );
  });

  it('times out pending requests', async () => {
    const { transport } = makeTransport();
    await expect(transport.request('initialize', {}, { timeoutMs: 1 })).rejects.toThrow(
      'ACP request timed out: initialize'
    );
  });

  it('captures redacted bounded stderr diagnostics', async () => {
    const { transport, stderr } = makeTransport(60);
    stderr.write('token: ghp_123456\n');
    stderr.write('x'.repeat(100));

    await tick();
    const summary = transport.diagnostics.summary();
    expect(summary).not.toContain('ghp_123456');
    expect(summary.length).toBeLessThan(120);
  });

  it('retains a bounded tail for a single oversized diagnostic entry', async () => {
    const { transport, stderr } = makeTransport(12);
    stderr.write('abcdefghijklmnop');

    await tick();
    expect(transport.diagnostics.summary()).toContain('efghijklmnop');
  });

  it('disposes only transport-owned stream listeners', async () => {
    const { transport, stdout } = makeTransport();
    let externalDataEvents = 0;
    stdout.on('data', () => {
      externalDataEvents += 1;
    });

    transport.dispose();
    stdout.write('outside\n');
    await tick();

    expect(externalDataEvents).toBe(1);
  });
});

describe('initializeAcpConnection', () => {
  it('sends safe default client capabilities and returns agent metadata', async () => {
    const { transport, stdout, writes } = makeTransport();
    const promise = initializeAcpConnection({ transport, timeoutMs: 100 });

    await tick();
    expect(JSON.parse(writes[0])).toMatchObject({
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: 'emdash', title: 'Emdash' },
      },
    });

    writeMessage(stdout, {
      jsonrpc: '2.0',
      id: 0,
      result: {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true },
        agentInfo: { name: 'fake-agent', version: '1.0.0' },
      },
    });

    await expect(promise).resolves.toEqual({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true },
      agentInfo: { name: 'fake-agent', version: '1.0.0' },
    });
  });

  it('rejects unsupported protocol versions', async () => {
    const { transport, stdout } = makeTransport();
    const promise = initializeAcpConnection({ transport, timeoutMs: 100 });

    writeMessage(stdout, {
      jsonrpc: '2.0',
      id: 0,
      result: { protocolVersion: 2 },
    });

    await expect(promise).rejects.toThrow('Unsupported ACP protocol version: 2');
  });
});
