import type Database from 'better-sqlite3';
import { tableExists } from './sqlite-utils';

function runDelete(sqlite: Database.Database, tableName: string, sql: string, ids: string[]): void {
  if (!tableExists(sqlite, tableName)) return;
  sqlite.prepare(sql).run(...ids);
}

export function deleteProjectsById(
  sqlite: Database.Database,
  projectIds: ReadonlySet<string>
): void {
  if (projectIds.size === 0) return;
  if (!tableExists(sqlite, 'projects')) return;

  const ids = [...projectIds];
  const placeholders = ids.map(() => '?').join(', ');

  if (tableExists(sqlite, 'conversations')) {
    runDelete(
      sqlite,
      'messages',
      `DELETE FROM messages WHERE conversation_id IN (
        SELECT id FROM conversations WHERE project_id IN (${placeholders})
      )`,
      ids
    );
  }

  runDelete(
    sqlite,
    'terminals',
    `DELETE FROM terminals WHERE project_id IN (${placeholders})`,
    ids
  );
  runDelete(
    sqlite,
    'conversations',
    `DELETE FROM conversations WHERE project_id IN (${placeholders})`,
    ids
  );
  runDelete(
    sqlite,
    'editor_buffers',
    `DELETE FROM editor_buffers WHERE project_id IN (${placeholders})`,
    ids
  );
  runDelete(
    sqlite,
    'project_remotes',
    `DELETE FROM project_remotes WHERE project_id IN (${placeholders})`,
    ids
  );
  runDelete(sqlite, 'tasks', `DELETE FROM tasks WHERE project_id IN (${placeholders})`, ids);
  sqlite.prepare(`DELETE FROM projects WHERE id IN (${placeholders})`).run(...ids);
}
