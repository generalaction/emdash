import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeSqliteDriver } from '../node/node-sqlite-driver';
import { runSqliteDriverConformance } from './conformance';

describe('node:sqlite driver conformance', () => {
  it('satisfies the SQLite store driver contract', () => {
    const path = join(tmpdir(), `sqlite-driver-conformance-${randomUUID()}.db`);
    try {
      expect(() => runSqliteDriverConformance(nodeSqliteDriver, path)).not.toThrow();
    } finally {
      for (const suffix of ['', '-wal', '-shm']) {
        rmSync(`${path}${suffix}`, { force: true });
      }
    }
  });
});
