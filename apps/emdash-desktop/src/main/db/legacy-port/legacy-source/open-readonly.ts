import Database from 'better-sqlite3';

export function openLegacyReadOnly(legacyPath: string): Database.Database {
  const legacyDb = new Database(legacyPath, { readonly: true, fileMustExist: true });
  try {
    legacyDb.pragma('query_only = ON');
  } catch {}
  return legacyDb;
}
