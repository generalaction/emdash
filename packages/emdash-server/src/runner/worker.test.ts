import { eq } from 'drizzle-orm';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { configSchema, type Config } from '../config.js';
import { initDb, getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { webhookEvents } from '../db/schema.js';
import { RunnerWorker } from './worker.js';
import type { RunResult } from './docker.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return configSchema.parse({
    apiKey: 'k',
    dbPath: ':memory:',
    claudeOauthToken: 'oauth-token',
    runner: { enabled: true, pollIntervalMs: 10, maxConcurrent: 1 },
    automations: [
      {
        token: 'wh_a',
        repoPath: '/opt/projects/doc-engine',
        prompt: 'scan it',
      },
    ],
    ...overrides,
  });
}

const ok: RunResult = { exitCode: 0, stdout: 'done', stderr: '', timedOut: false };

async function status(id: string): Promise<{ status: string; error: string | null }> {
  const [row] = await getDb()
    .select({ status: webhookEvents.status, error: webhookEvents.error })
    .from(webhookEvents)
    .where(eq(webhookEvents.id, id));
  return row!;
}

beforeEach(() => {
  initDb(':memory:');
  runMigrations();
  vi.restoreAllMocks();
});

describe('RunnerWorker.tick', () => {
  it('runs the matching automation and marks the event processed', async () => {
    await getDb()
      .insert(webhookEvents)
      .values({ id: 'e1', token: 'wh_a', payload: '{}', status: 'pending', createdAt: 1 });

    const run = vi.fn().mockResolvedValue(ok);
    const worker = new RunnerWorker({ config: makeConfig(), run, uid: 1, gid: 1, log: () => {} });

    await worker.tick();
    // process() runs async after tick schedules it; flush microtasks.
    await vi.waitFor(async () => expect((await status('e1')).status).toBe('processed'));

    expect(run).toHaveBeenCalledOnce();
    const [automation, token, uid, gid] = run.mock.calls[0]!;
    expect(automation.token).toBe('wh_a');
    expect(token).toBe('oauth-token');
    expect(uid).toBe(1);
    expect(gid).toBe(1);
  });

  it('leaves events with no configured automation pending', async () => {
    await getDb()
      .insert(webhookEvents)
      .values({ id: 'e2', token: 'wh_unknown', payload: '{}', status: 'pending', createdAt: 1 });

    const run = vi.fn().mockResolvedValue(ok);
    const worker = new RunnerWorker({ config: makeConfig(), run, log: () => {} });

    await worker.tick();
    expect(run).not.toHaveBeenCalled();
    expect((await status('e2')).status).toBe('pending');
  });

  it('marks the event failed on a non-zero exit and records stderr', async () => {
    await getDb()
      .insert(webhookEvents)
      .values({ id: 'e3', token: 'wh_a', payload: '{}', status: 'pending', createdAt: 1 });

    const run = vi.fn().mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'boom',
      timedOut: false,
    } satisfies RunResult);
    const worker = new RunnerWorker({ config: makeConfig(), run, log: () => {} });

    await worker.tick();
    await vi.waitFor(async () => expect((await status('e3')).status).toBe('failed'));
    expect((await status('e3')).error).toContain('boom');
  });

  it('marks the event failed on timeout', async () => {
    await getDb()
      .insert(webhookEvents)
      .values({ id: 'e4', token: 'wh_a', payload: '{}', status: 'pending', createdAt: 1 });

    const run = vi.fn().mockResolvedValue({
      exitCode: null,
      stdout: '',
      stderr: '',
      timedOut: true,
    } satisfies RunResult);
    const worker = new RunnerWorker({ config: makeConfig(), run, log: () => {} });

    await worker.tick();
    await vi.waitFor(async () => expect((await status('e4')).status).toBe('failed'));
    expect((await status('e4')).error).toContain('timed out');
  });

  it('marks the event failed when the run throws', async () => {
    await getDb()
      .insert(webhookEvents)
      .values({ id: 'e5', token: 'wh_a', payload: '{}', status: 'pending', createdAt: 1 });

    const run = vi.fn().mockRejectedValue(new Error('docker missing'));
    const worker = new RunnerWorker({ config: makeConfig(), run, log: () => {} });

    await worker.tick();
    await vi.waitFor(async () => expect((await status('e5')).status).toBe('failed'));
    expect((await status('e5')).error).toContain('docker missing');
  });

  it('respects maxConcurrent: only runs up to capacity per tick', async () => {
    await getDb()
      .insert(webhookEvents)
      .values([
        { id: 'a', token: 'wh_a', payload: '{}', status: 'pending', createdAt: 1 },
        { id: 'b', token: 'wh_a', payload: '{}', status: 'pending', createdAt: 2 },
        { id: 'c', token: 'wh_a', payload: '{}', status: 'pending', createdAt: 3 },
      ]);

    // A run that blocks until we release it, so inFlight stays elevated.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const run = vi.fn().mockImplementation(async () => {
      await gate;
      return ok;
    });
    const worker = new RunnerWorker({
      config: makeConfig({ runner: { enabled: true, pollIntervalMs: 10, maxConcurrent: 2 } }),
      run,
      log: () => {},
    });

    await worker.tick();
    // maxConcurrent=2 → exactly 2 started while the gate is closed.
    expect(run).toHaveBeenCalledTimes(2);

    release();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
  });
});

describe('RunnerWorker.start', () => {
  it('does nothing when runner.enabled is false', () => {
    const logs: string[] = [];
    const worker = new RunnerWorker({
      config: makeConfig({ runner: { enabled: false, pollIntervalMs: 10, maxConcurrent: 1 } }),
      run: vi.fn(),
      log: (_l, m) => logs.push(m),
    });
    worker.start();
    worker.stop();
    expect(logs.some((m) => m.includes('disabled'))).toBe(true);
  });
});
