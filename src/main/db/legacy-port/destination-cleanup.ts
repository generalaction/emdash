import type Database from 'better-sqlite3';
import { tableExists, withForeignKeysEnabled } from './sqlite-utils';

export function deleteProjectsById(
  sqlite: Database.Database,
  projectIds: ReadonlySet<string>
): void {
  if (projectIds.size === 0) return;
  if (!tableExists(sqlite, 'projects')) return;

  const ids = [...projectIds];
  const placeholders = ids.map(() => '?').join(', ');

  withForeignKeysEnabled(sqlite, () => {
    sqlite.prepare(`DELETE FROM projects WHERE id IN (${placeholders})`).run(...ids);
  });
}
