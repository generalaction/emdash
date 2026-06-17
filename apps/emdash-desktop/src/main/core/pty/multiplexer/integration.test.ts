/**
 * Detection-guarded integration smoke test for the boo multiplexer backend.
 *
 * Requires `boo` on PATH to run — guarded by `it.skipIf(!hasBoo)`. When boo is
 * absent the suite is skipped and does not fail CI. When boo IS present (as in
 * local dev where boo 0.5.20 is installed) all tests run against the real binary.
 */

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { booBackend } from './boo';

const execFileAsync = promisify(execFile);

/** Resolve `boo` synchronously by attempting a version call. */
function detectBoo(): boolean {
  try {
    // We can only use sync detection here (module-load time).
    // Use execFileSync so the check is blocking and available before tests run.
    const { execFileSync } = require('node:child_process'); // eslint-disable-line @typescript-eslint/no-require-imports
    execFileSync('boo', ['version'], { timeout: 3000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const hasBoo = detectBoo();

/** Run `boo ls` and return the raw stdout string. */
async function booLs(): Promise<string> {
  const { stdout } = await execFileAsync('boo', ['ls'], { timeout: 5000 });
  return stdout;
}

/** Return true if `boo ls` output contains a session named exactly `name`. */
function sessionListed(lsOutput: string, name: string): boolean {
  // Each line of `boo ls` output starts with the session name (before spaces/tabs).
  return lsOutput.split('\n').some((line) => {
    const firstToken = line.trimStart().split(/\s+/)[0];
    return firstToken === name;
  });
}

describe('boo multiplexer backend integration', () => {
  const ctx = new LocalExecutionContext();
  const createdSessions: string[] = [];

  afterEach(async () => {
    // Best-effort cleanup — kill all sessions we created, even if the test failed.
    await Promise.allSettled(
      createdSessions.splice(0).map((name) => booBackend.killSession(ctx, name))
    );
  });

  it.skipIf(!hasBoo)(
    'creates a real boo session, lists it, then kills it via booBackend.killSession',
    async () => {
      const uniqueId = `integration-smoke-${randomBytes(6).toString('hex')}`;
      const sessionName = booBackend.makeSessionName(uniqueId);
      createdSessions.push(sessionName);

      // Create a detached boo session via the real boo binary (not through our shell-line
      // builder, which would need a real TTY to attach). `boo new <name> -d -- <cmd>` exits
      // immediately once the session is running in the background.
      await execFileAsync('boo', ['new', sessionName, '-d', '--', '/bin/sh', '-c', 'sleep 30'], {
        timeout: 8000,
      });

      // Assert the session appears in `boo ls`.
      const lsAfterCreate = await booLs();
      expect(sessionListed(lsAfterCreate, sessionName)).toBe(true);

      // Kill via our backend function (the real path our production code takes).
      await booBackend.killSession(ctx, sessionName);

      // Assert the session is gone from `boo ls`.
      const lsAfterKill = await booLs();
      expect(sessionListed(lsAfterKill, sessionName)).toBe(false);
    },
    15_000 // generous timeout for process spawn + kill
  );
});
