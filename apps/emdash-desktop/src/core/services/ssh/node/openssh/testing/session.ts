import { PassThrough } from 'node:stream';
import { vi } from 'vitest';
import type { SshSession } from '../session';
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export function fakeSession(): SshSession & {
  lost: ReturnType<typeof deferred<Error | undefined>>;
} {
  const lost = deferred<Error | undefined>();
  return {
    lost,
    closed: lost.promise,
    close: vi.fn(async () => {
      lost.resolve(undefined);
    }),
    exec: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    openStream: vi.fn(async () => new PassThrough()),
    forwardPort: vi.fn(),
  };
}
