import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

let cleanup: { sqlite: BetterSqlite3.Database; root: string } | undefined;

afterEach(async () => {
  cleanup?.sqlite.close();
  if (cleanup) await rm(cleanup.root, { recursive: true, force: true });
  cleanup = undefined;
  delete process.env.EMDASH_DB_FILE;
  vi.resetModules();
});

describe('e2eProgressStore', () => {
  it('atomically commits terminal Loop/phase progress and rejects a stale snapshot', async () => {
    const loaded = await loadStore();
    cleanup = loaded;
    const { store, sqlite, initial } = loaded;
    const snapshot = await store.read({ loopId: 'loop-1', phaseId: 'phase-1' });
    expect(snapshot).toEqual({ success: true, data: initial });
    if (!snapshot.success) return;

    const result = await store.commit({
      loopId: 'loop-1',
      phaseId: 'phase-1',
      expected: snapshot.data,
      transition: {
        kind: 'terminal',
        checkpointCommit: initial.loopState.checkpointCommit!,
        handoff: null,
        result: {
          status: 'passed',
          summary: 'Clean-room E2E passed.',
          completedAt: '2026-07-12T03:00:00.000Z',
        },
      },
    });
    expect(result).toMatchObject({
      success: true,
      data: { phaseState: { result: { status: 'passed' } } },
    });
    expect(
      sqlite.prepare('SELECT status, last_error FROM loop_phases WHERE id = ?').get('phase-1')
    ).toEqual({ status: 'passed', last_error: null });

    const stale = await store.commit({
      loopId: 'loop-1',
      phaseId: 'phase-1',
      expected: snapshot.data,
      transition: { kind: 'workspace', verification: null },
    });
    expect(stale).toMatchObject({ success: false, error: { type: 'conflict' } });
  }, 15_000);
});

async function loadStore() {
  vi.resetModules();
  const root = await mkdtemp(join(tmpdir(), 'emdash-e2e-progress-'));
  process.env.EMDASH_DB_FILE = join(root, 'test.db');
  const [{ sqlite }, { e2eProgressStore }] = await Promise.all([
    import('@main/db/client'),
    import('./e2e-progress-store'),
  ]);
  sqlite.exec(`
    CREATE TABLE loops (
      id TEXT PRIMARY KEY,
      state TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE loop_phases (
      id TEXT PRIMARY KEY,
      loop_id TEXT NOT NULL,
      status TEXT NOT NULL,
      state TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const checkpoint = '1'.repeat(40);
  const initial = {
    loopState: {
      version: '2' as const,
      baseCommit: checkpoint,
      expectedFeatureHead: checkpoint,
      checkpointCommit: checkpoint,
      e2eAttemptsConsumed: 0,
      sessionAttempts: [],
      verification: null,
    },
    phaseState: {
      version: '2' as const,
      checkpointCommit: null,
      handoff: null,
      retryHandoffs: [],
      result: null,
    },
  };
  sqlite
    .prepare('INSERT INTO loops (id, state) VALUES (?, ?)')
    .run('loop-1', JSON.stringify(initial.loopState));
  sqlite
    .prepare('INSERT INTO loop_phases (id, loop_id, status, state) VALUES (?, ?, ?, ?)')
    .run('phase-1', 'loop-1', 'reviewing', JSON.stringify(initial.phaseState));
  return { store: e2eProgressStore, sqlite, root, initial };
}
