import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoopStateV2 } from '@shared/core/loops/loop-state';

let cleanup: { sqlite: BetterSqlite3.Database; root: string } | undefined;

afterEach(async () => {
  cleanup?.sqlite.close();
  if (cleanup) await rm(cleanup.root, { recursive: true, force: true });
  cleanup = undefined;
  delete process.env.EMDASH_DB_FILE;
  vi.resetModules();
});

describe('commitSessionAttempt', () => {
  it('accepts semantically equal state with a different JSON key order and rejects stale state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-loop-session-progress-'));
    process.env.EMDASH_DB_FILE = join(root, 'test.db');
    const [{ sqlite }, { commitSessionAttempt }] = await Promise.all([
      import('@main/db/client'),
      import('./session-progress'),
    ]);
    cleanup = { sqlite, root };
    sqlite.exec(`
      CREATE TABLE loops (
        id TEXT PRIMARY KEY,
        state TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const checkpoint = '1'.repeat(40);
    const stored: LoopStateV2 = {
      version: '2',
      baseCommit: checkpoint,
      expectedFeatureHead: checkpoint,
      checkpointCommit: checkpoint,
      e2eAttemptsConsumed: 0,
      sessionAttempts: [],
      verification: null,
    };
    const reordered: LoopStateV2 = {
      sessionAttempts: [],
      verification: null,
      e2eAttemptsConsumed: 0,
      checkpointCommit: checkpoint,
      expectedFeatureHead: checkpoint,
      baseCommit: checkpoint,
      version: '2',
    };
    sqlite
      .prepare('INSERT INTO loops (id, state) VALUES (?, ?)')
      .run('loop-1', JSON.stringify(stored));

    const first = await commitSessionAttempt({
      loopId: 'loop-1',
      expected: reordered,
      next: {
        attemptId: 'attempt-1',
        conversationId: 'conversation-1',
        purpose: 'work',
        phaseId: 'phase-1',
        target: { workspaceId: 'workspace-1', path: '/workspace', machine: { kind: 'local' } },
        status: 'starting',
        checkpointBefore: checkpoint,
        startedAt: '2026-08-01T00:00:00.000Z',
      },
    });
    expect(first).toMatchObject({
      success: true,
      data: { sessionAttempts: [{ attemptId: 'attempt-1', status: 'starting' }] },
    });

    const stale = await commitSessionAttempt({
      loopId: 'loop-1',
      expected: reordered,
      next: {
        attemptId: 'attempt-2',
        conversationId: 'conversation-2',
        purpose: 'work',
        phaseId: 'phase-2',
        target: { workspaceId: 'workspace-1', path: '/workspace', machine: { kind: 'local' } },
        status: 'starting',
        checkpointBefore: checkpoint,
        startedAt: '2026-08-01T00:01:00.000Z',
      },
    });
    expect(stale).toMatchObject({ success: false, error: { kind: 'conflict' } });
  });
});
