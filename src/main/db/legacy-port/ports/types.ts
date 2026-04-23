import type Database from 'better-sqlite3';
import type { RemapTables } from '../remap';

export type PortContext = {
  appDb: Database.Database;
  legacyDb: Database.Database;
  remap: RemapTables;
};

export type PortSummary = {
  table: string;
  considered: number;
  inserted: number;
  skippedDedup: number;
  skippedInvalid: number;
  skippedError: number;
};

export function createPortSummary(table: string): PortSummary {
  return {
    table,
    considered: 0,
    inserted: 0,
    skippedDedup: 0,
    skippedInvalid: 0,
    skippedError: 0,
  };
}
