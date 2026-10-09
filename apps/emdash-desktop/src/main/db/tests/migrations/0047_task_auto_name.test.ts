import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('0047 task auto naming', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('pre-0047');
  });

  afterEach(() => fixture.close());

  it('keeps existing tasks ineligible and preserves their names', () => {
    const rows = fixture.sqlite
      .prepare('SELECT name, auto_name_conversation_id FROM tasks')
      .all() as { name: string; auto_name_conversation_id: string | null }[];

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.auto_name_conversation_id === null)).toBe(true);
    expect(rows.some((row) => row.name === 'Add workspace database entity')).toBe(true);
  });

  it('round-trips the initial conversation marker', () => {
    fixture.sqlite
      .prepare(
        'UPDATE tasks SET auto_name_conversation_id = ? WHERE id = (SELECT id FROM tasks LIMIT 1)'
      )
      .run('conversation-1');

    expect(
      fixture.sqlite
        .prepare('SELECT auto_name_conversation_id FROM tasks WHERE auto_name_conversation_id = ?')
        .get('conversation-1')
    ).toEqual({ auto_name_conversation_id: 'conversation-1' });
  });
});
