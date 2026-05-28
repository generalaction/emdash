import { openFixture } from '@tooling/utils/db';
import { afterEach, describe, expect, it } from 'vitest';

describe('0012 conversation runtime mode migration', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  afterEach(() => {
    fixture?.close();
  });

  it('adds a non-null runtime_mode column defaulting to terminal', async () => {
    fixture = await openFixture('pre-0012');

    const columns = fixture.sqlite.prepare(`PRAGMA table_info(conversations)`).all() as {
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }[];

    const runtimeMode = columns.find((column) => column.name === 'runtime_mode');
    expect(runtimeMode).toBeDefined();
    expect(runtimeMode?.type.toLowerCase()).toBe('text');
    expect(runtimeMode?.notnull).toBe(1);
    expect(runtimeMode?.dflt_value).toBe("'terminal'");
  });

  it('backfills existing conversations to terminal runtime', async () => {
    fixture = await openFixture('pre-0012');

    const summary = fixture.sqlite
      .prepare(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN runtime_mode = 'terminal' THEN 1 ELSE 0 END) AS terminal_count FROM conversations`
      )
      .get() as { total: number; terminal_count: number | null };

    expect(summary.total).toBeGreaterThan(0);
    expect(summary.terminal_count).toBe(summary.total);
  });

  it('uses terminal runtime for new rows when runtime_mode is omitted', async () => {
    fixture = await openFixture('pre-0012');

    const task = fixture.sqlite.prepare(`SELECT id, project_id FROM tasks LIMIT 1`).get() as {
      id: string;
      project_id: string;
    };

    fixture.sqlite
      .prepare(
        `INSERT INTO conversations (id, project_id, task_id, title, provider, created_at, updated_at)
         VALUES ('conversation-runtime-default', @projectId, @taskId, 'Runtime default', 'codex', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
      .run({ projectId: task.project_id, taskId: task.id });

    const row = fixture.sqlite
      .prepare(`SELECT runtime_mode FROM conversations WHERE id = 'conversation-runtime-default'`)
      .get() as { runtime_mode: string };

    expect(row.runtime_mode).toBe('terminal');
  });
});
