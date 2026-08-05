import { openFixture } from '@tooling/utils/db';
import { afterEach, describe, expect, it } from 'vitest';

describe('0020_lifecycle_teardown_marker', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  afterEach(() => {
    fixture?.close();
  });

  it('adds nullable durable teardown phase markers without marking legacy tasks', async () => {
    fixture = await openFixture('pre-0020');

    const columns = fixture.sqlite.prepare('PRAGMA table_info(tasks)').all() as {
      name: string;
      notnull: number;
    }[];
    expect(columns).toContainEqual(
      expect.objectContaining({ name: 'lifecycle_teardown_at', notnull: 0 })
    );
    expect(columns).toContainEqual(
      expect.objectContaining({ name: 'provider_destroy_at', notnull: 0 })
    );

    const markedLegacyTasks = fixture.sqlite
      .prepare(
        `SELECT COUNT(*) AS count
         FROM tasks
         WHERE lifecycle_teardown_at IS NOT NULL OR provider_destroy_at IS NOT NULL`
      )
      .get() as { count: number };
    expect(markedLegacyTasks.count).toBe(0);
  });
});
