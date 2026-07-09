import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { childProcessHost } from './child-process-host';

describe('childProcessHost', () => {
  it('spawns a child process and adapts ipc, stdio, and exit events', async () => {
    const host = childProcessHost();
    const process = await host.spawn({ entry: fixturePath() });
    const stdout = waitForStdio(process, 'stdout');
    const stderr = waitForStdio(process, 'stderr');
    const exit = waitForExit(process);

    const echo = waitForMessage(process);
    process.send({ kind: 'echo', value: 'hello' });
    await expect(echo).resolves.toEqual({ kind: 'echo', value: 'hello' });

    process.send({ kind: 'stdio', value: 'one' });
    await expect(stdout).resolves.toContain('stdout:one');
    await expect(stderr).resolves.toContain('stderr:one');

    process.send({ kind: 'exit', code: 3 });
    await expect(exit).resolves.toMatchObject({ code: 3, willRestart: false });
  });

  it('preserves undefined object properties across the ipc channel', async () => {
    const host = childProcessHost();
    const process = await host.spawn({ entry: fixturePath() });

    const echo = waitForMessage(process);
    process.send({ kind: 'echo', value: 'result', data: undefined });
    const message = (await echo) as Record<string, unknown>;
    expect('data' in message).toBe(true);
    expect(message.data).toBeUndefined();

    const exit = waitForExit(process);
    process.send({ kind: 'exit', code: 0 });
    await exit;
  });
});

function fixturePath(): string {
  return fileURLToPath(new URL('./fixtures/echo-child.mjs', import.meta.url));
}

function waitForMessage(process: { onMessage(cb: (message: unknown) => void): () => void }) {
  return new Promise<unknown>((resolve) => {
    const unsubscribe = process.onMessage((message) => {
      unsubscribe();
      resolve(message);
    });
  });
}

function waitForStdio(
  process: { onStdio(cb: (stream: 'stdout' | 'stderr', chunk: string) => void): () => void },
  expected: 'stdout' | 'stderr'
) {
  return new Promise<string>((resolve) => {
    const unsubscribe = process.onStdio((stream, chunk) => {
      if (stream !== expected) return;
      unsubscribe();
      resolve(chunk);
    });
  });
}

function waitForExit(process: {
  onExit(cb: (exit: { code: number | null; willRestart: boolean }) => void): () => void;
}) {
  return new Promise<{ code: number | null; willRestart: boolean }>((resolve) => {
    const unsubscribe = process.onExit((exit) => {
      unsubscribe();
      resolve(exit);
    });
  });
}
