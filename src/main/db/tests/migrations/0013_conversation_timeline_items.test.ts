import { openFixture } from '@tooling/utils/db';
import { afterEach, describe, expect, it } from 'vitest';

describe('0013 conversation timeline items migration', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  afterEach(() => {
    fixture?.close();
  });

  it('creates the conversation_timeline_items table with expected columns', async () => {
    fixture = await openFixture('pre-0013');

    const columns = fixture.sqlite
      .prepare(`PRAGMA table_info(conversation_timeline_items)`)
      .all() as {
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }[];

    expect(columns.map((column) => column.name)).toEqual([
      'id',
      'conversation_id',
      'sequence',
      'kind',
      'payload',
      'created_at',
    ]);
    expect(columns.find((column) => column.name === 'conversation_id')?.notnull).toBe(1);
    expect(columns.find((column) => column.name === 'sequence')?.notnull).toBe(1);
    expect(columns.find((column) => column.name === 'created_at')?.dflt_value).toBe(
      'CURRENT_TIMESTAMP'
    );
  });

  it('creates indexes for conversation lookup and stable sequencing', async () => {
    fixture = await openFixture('pre-0013');

    const indexes = fixture.sqlite
      .prepare(
        `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'conversation_timeline_items'`
      )
      .all() as { name: string; sql: string | null }[];

    const names = indexes.map((index) => index.name);
    expect(names).toContain('idx_conversation_timeline_items_conversation_id');
    expect(names).toContain('idx_conversation_timeline_items_conversation_sequence');

    const sequenceIndex = indexes.find(
      (index) => index.name === 'idx_conversation_timeline_items_conversation_sequence'
    );
    expect(sequenceIndex?.sql?.toLowerCase()).toContain('unique');
  });

  it('cascades timeline rows when a conversation is deleted', async () => {
    fixture = await openFixture('pre-0013');
    fixture.sqlite.pragma('foreign_keys = ON');

    const conversation = fixture.sqlite.prepare(`SELECT id FROM conversations LIMIT 1`).get() as {
      id: string;
    };

    fixture.sqlite
      .prepare(
        `INSERT INTO conversation_timeline_items (id, conversation_id, sequence, kind, payload)
         VALUES ('timeline-1', @conversationId, 1, 'user_message', '{"text":"hello"}')`
      )
      .run({ conversationId: conversation.id });

    fixture.sqlite.prepare(`DELETE FROM conversations WHERE id = @conversationId`).run({
      conversationId: conversation.id,
    });

    const row = fixture.sqlite
      .prepare(`SELECT COUNT(*) AS count FROM conversation_timeline_items WHERE id = 'timeline-1'`)
      .get() as { count: number };

    expect(row.count).toBe(0);
  });
});
