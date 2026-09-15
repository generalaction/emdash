import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'tsdown';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MUSE_COMPLETION_PATH, museStartCommand } from './completion';

const OBSERVER_SETTLE_MS = 600;

let helperSource: string;
let buildDirectory: string;
beforeAll(async () => {
  buildDirectory = await mkdtemp(path.join(os.tmpdir(), 'muse-observer-build-'));
  await build({
    config: false,
    entry: {
      'muse-completion': fileURLToPath(new URL('./completion-observer.ts', import.meta.url)),
    },
    outDir: buildDirectory,
    format: 'esm',
    dts: false,
  });
  helperSource = await readFile(path.join(buildDirectory, 'muse-completion.mjs'), 'utf8');
});
afterAll(async () => {
  if (buildDirectory) await rm(buildDirectory, { recursive: true, force: true });
});

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function setup(useXdgConfigHome = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), "muse observer's test "));
  const session = '01a0a6b0-45b2-7fd1-9f51-ca8c636535d4';
  const turn = '8c58ccb6-fac5-4a35-bbe8-fdcc5064db2d';
  const file = path.join(root, 'muse/sessions/2026/09/15', session, 'session.jsonl');
  const configHome = path.join(root, useXdgConfigHome ? 'config' : '.config');
  await mkdir(path.join(configHome, 'muse'), { recursive: true });
  await writeFile(path.join(configHome, 'muse', MUSE_COMPLETION_PATH), helperSource);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '');
  const events: string[] = [];
  const server = createServer((req, res) => {
    expect(req.headers['x-emdash-token']).toBe('test-nonce');
    expect(req.headers['x-emdash-pty-id']).toBe('test-conversation');
    events.push(String(req.headers['x-emdash-event-type']));
    req.resume();
    res.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });
  const hook = spawn('/bin/sh', ['-c', museStartCommand()], {
    env: {
      ...process.env,
      XDG_DATA_HOME: root,
      HOME: root,
      XDG_CONFIG_HOME: useXdgConfigHome ? configHome : undefined,
      EMDASH_HOOK_PORT: String(address.port),
      EMDASH_HOOK_NONCE: 'test-nonce',
      EMDASH_PTY_ID: 'test-conversation',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  hook.stderr.on('data', (data) => {
    stderr += data;
  });
  hook.stdin.end(JSON.stringify({ session_id: session, turn_id: turn }));
  const [code] = await once(hook, 'exit');
  expect(stderr).toBe('');
  expect(code).toBe(0);
  const record = (event: object, runId = turn, sessionId = session) =>
    JSON.stringify({
      stream: { kind: 'session', id: sessionId },
      payload_type: 'runtime.session',
      payload: { kind: 'run', run_id: runId, event },
    }) + '\n';
  return { events, file, record };
}

describe('Muse durable completion observer', () => {
  it('finds the installed helper with the default config directory', async () => {
    const { events, file, record } = await setup(false);
    await appendFile(file, record({ kind: 'terminal', terminal: 'completed' }));
    await expect.poll(() => events).toContain('stop');
  });
  it.each(['completed', 'failed', 'cancelled'])(
    'reports an exact-turn %s terminal',
    async (terminal) => {
      const { events, file, record } = await setup();
      await appendFile(file, record({ kind: 'started' }));
      await appendFile(
        file,
        record({ kind: 'assistant_message_committed', text: 'intermediate reply' })
      );
      await appendFile(file, record({ kind: 'terminal', terminal: 'completed' }, 'another-turn'));
      await new Promise((resolve) => setTimeout(resolve, OBSERVER_SETTLE_MS));
      expect(events.filter((event) => ['start', 'stop', 'error'].includes(event))).toEqual([
        'start',
      ]);
      const line = record({ kind: 'terminal', terminal });
      const midpoint = Math.floor(line.length / 2);
      await appendFile(file, line.slice(0, midpoint));
      await new Promise((resolve) => setTimeout(resolve, OBSERVER_SETTLE_MS));
      expect(events).not.toContain('stop');
      await appendFile(file, line.slice(midpoint));
      await expect.poll(() => events).toContain(terminal === 'failed' ? 'error' : 'stop');
    }
  );

  it('ignores another session and retires when a newer turn starts', async () => {
    const { events, file, record } = await setup();
    await appendFile(
      file,
      record({ kind: 'terminal', terminal: 'completed' }, undefined, 'other-session')
    );
    await appendFile(file, record({ kind: 'started' }, 'newer-turn'));
    await appendFile(file, record({ kind: 'terminal', terminal: 'completed' }));
    await new Promise((resolve) => setTimeout(resolve, OBSERVER_SETTLE_MS));
    expect(events.filter((event) => ['start', 'stop', 'error'].includes(event))).toEqual(['start']);
  });
});
