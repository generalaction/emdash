import type Database from 'better-sqlite3';
import { quoteIdentifier } from '../../sqlite-utils';

export function legacyTableExists(legacyDb: Database.Database, tableName: string): boolean {
  const row = legacyDb
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
    .get(tableName);
  return Boolean(row);
}

function getLegacyTableColumns(legacyDb: Database.Database, tableName: string): Set<string> {
  if (!legacyTableExists(legacyDb, tableName)) return new Set();

  const rows = legacyDb.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all() as Array<{
    name: string;
  }>;

  return new Set(rows.map((row) => row.name));
}

export function readLegacyRows(
  legacyDb: Database.Database,
  tableName: string,
  columns: string[]
): Array<Record<string, unknown>> {
  if (!legacyTableExists(legacyDb, tableName)) return [];

  const tableColumns = getLegacyTableColumns(legacyDb, tableName);
  const selectColumns = columns
    .map((column) => {
      const alias = quoteIdentifier(column);
      if (tableColumns.has(column)) {
        return `${quoteIdentifier(column)} AS ${alias}`;
      }
      return `NULL AS ${alias}`;
    })
    .join(', ');

  return legacyDb
    .prepare(`SELECT ${selectColumns} FROM ${quoteIdentifier(tableName)}`)
    .all() as Array<Record<string, unknown>>;
}

export function toTrimmedString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

export function toInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function toIsoTimestamp(value: unknown, fallback: string): string {
  return toTrimmedString(value) ?? fallback;
}

export function isUniqueConstraintError(error: unknown, detail: string): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes('UNIQUE constraint failed') &&
    error.message.toLowerCase().includes(detail.toLowerCase())
  );
}
