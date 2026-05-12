import type { AppDb } from '@main/db/client';

// No data — only the schema is applied. Useful as a clean baseline for
// migration tests that need to start from a completely empty database.
export async function empty(_db: AppDb): Promise<void> {}
