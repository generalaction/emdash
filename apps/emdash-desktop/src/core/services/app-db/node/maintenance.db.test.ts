import { openFixture, type FixtureDb } from '@tooling/utils/db';
import { afterEach, describe, expect, it } from 'vitest';
import { compactDatabase, getDatabaseSpace } from './maintenance';

describe('app database maintenance', () => {
  let fixture: FixtureDb | undefined;

  afterEach(() => {
    fixture?.close();
    fixture = undefined;
  });

  it('reports free pages and reclaims them on compaction', async () => {
    fixture = await openFixture('empty');
    const insert = fixture.sqlite.prepare(`INSERT INTO kv (key, value) VALUES (?, ?)`);
    const payload = 'x'.repeat(4096);
    fixture.sqlite.transaction(() => {
      for (let i = 0; i < 500; i++) insert.run(`filler-${i}`, payload);
    })();
    fixture.sqlite.prepare(`DELETE FROM kv WHERE key LIKE 'filler-%'`).run();
    fixture.sqlite.pragma('wal_checkpoint(TRUNCATE)');

    const before = getDatabaseSpace(fixture.db);
    expect(before.freeBytes).toBeGreaterThan(0);

    const freed = compactDatabase(fixture.db);

    const after = getDatabaseSpace(fixture.db);
    expect(freed).toBeGreaterThan(0);
    expect(after.freeBytes).toBe(0);
    expect(after.fileBytes).toBe(before.fileBytes - freed);
  });
});
