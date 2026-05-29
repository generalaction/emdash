import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { CodexAppServerTransport } from './codex-app-server-transport';

function makeChild(): ChildProcessWithoutNullStreams & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
} {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true) as ChildProcessWithoutNullStreams['kill'];
  Object.defineProperties(child, {
    killed: { value: false },
    exitCode: { value: null },
    signalCode: { value: null },
    pid: { value: 123 },
  });
  return child;
}

function readJsonLine(stream: PassThrough): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    stream.once('data', (chunk) => {
      resolve(JSON.parse(chunk.toString().trim()) as Record<string, unknown>);
    });
  });
}

describe('CodexAppServerTransport', () => {
  it('matches JSON-RPC responses to pending requests', async () => {
    const child = makeChild();
    const transport = new CodexAppServerTransport(child);
    const outbound = readJsonLine(child.stdin);

    const resultPromise = transport.request('thread/start', { cwd: '/repo' });
    const request = await outbound;
    expect(request).toMatchObject({
      id: 1,
      method: 'thread/start',
      params: { cwd: '/repo' },
    });

    child.stdout.write(`${JSON.stringify({ id: 1, result: { thread: { id: 'thread-1' } } })}\n`);

    await expect(resultPromise).resolves.toEqual({ thread: { id: 'thread-1' } });
  });

  it('rejects JSON-RPC error responses', async () => {
    const child = makeChild();
    const transport = new CodexAppServerTransport(child);
    const resultPromise = transport.request('turn/start', {});
    await readJsonLine(child.stdin);

    child.stdout.write(`${JSON.stringify({ id: 1, error: { message: 'bad request' } })}\n`);

    await expect(resultPromise).rejects.toThrow('bad request');
  });

  it('routes notifications and ignores malformed stdout', async () => {
    const child = makeChild();
    const transport = new CodexAppServerTransport(child);
    const onNotification = vi.fn();
    transport.setNotificationHandler(onNotification);

    child.stdout.write('not-json\n');
    child.stdout.write(`${JSON.stringify({ method: 'thread/compacted', params: { ok: true } })}\n`);

    expect(onNotification).toHaveBeenCalledWith('thread/compacted', { ok: true });
  });

  it('routes server requests through the request handler and writes JSON-RPC responses', async () => {
    const child = makeChild();
    const transport = new CodexAppServerTransport(child);
    transport.setRequestHandler((method, params, requestId) => {
      expect(method).toBe('item/commandExecution/requestApproval');
      expect(params).toEqual({ itemId: 'item-1' });
      expect(requestId).toBe(7);
      return { decision: 'accept' };
    });
    const outbound = readJsonLine(child.stdin);

    child.stdout.write(
      `${JSON.stringify({
        id: 7,
        method: 'item/commandExecution/requestApproval',
        params: { itemId: 'item-1' },
      })}\n`
    );

    await expect(outbound).resolves.toEqual({ id: 7, result: { decision: 'accept' } });
  });

  it('writes JSON-RPC errors when server request handlers reject', async () => {
    const child = makeChild();
    const transport = new CodexAppServerTransport(child);
    transport.setRequestHandler(() => {
      throw new Error('handler failed');
    });
    const outbound = readJsonLine(child.stdin);

    child.stdout.write(`${JSON.stringify({ id: 8, method: 'custom/request', params: {} })}\n`);

    await expect(outbound).resolves.toEqual({
      id: 8,
      error: { message: 'handler failed' },
    });
  });

  it('rejects requests after dispose and disposes idempotently', async () => {
    const child = makeChild();
    const transport = new CodexAppServerTransport(child);

    await transport.dispose();
    await transport.dispose();

    await expect(transport.request('thread/start', {})).rejects.toThrow(
      'Codex app-server transport is closed'
    );
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('rejects pending requests when disposed', async () => {
    const child = makeChild();
    const transport = new CodexAppServerTransport(child);
    const pending = transport.request('turn/start', {});
    await readJsonLine(child.stdin);

    await transport.dispose();

    await expect(pending).rejects.toThrow('Codex app-server transport is closed');
  });

  it('rejects new requests when stdin is already closed', async () => {
    const child = makeChild();
    const transport = new CodexAppServerTransport(child);
    child.stdin.end();

    await expect(transport.request('turn/start', {})).rejects.toThrow(
      'Codex app-server transport is closed'
    );
  });

  it('rejects pending requests when app-server exits', async () => {
    const child = makeChild();
    const transport = new CodexAppServerTransport(child);
    const pending = transport.request('turn/start', {});
    await readJsonLine(child.stdin);

    child.stderr.write('boom');
    child.emit('exit', 1, null);

    await expect(pending).rejects.toThrow('boom');
  });

  it('notifies exit handlers when app-server exits without pending requests', async () => {
    const child = makeChild();
    const transport = new CodexAppServerTransport(child);
    const onExit = vi.fn();
    transport.setExitHandler(onExit);

    child.emit('exit', 0, null);

    expect(onExit).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Codex app-server exited') })
    );
  });
});
