import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { log } from '@main/lib/logger';
import { BROWSER_PARTITION_PREFIX, BROWSER_PROFILE_PARTITION } from '@shared/browser';

const PERSIST_PREFIX = 'persist:';
const LEGACY_DIR_PREFIX = `${BROWSER_PARTITION_PREFIX.slice(PERSIST_PREFIX.length)}-`;
const PROFILE_DIR_NAME = BROWSER_PROFILE_PARTITION.slice(PERSIST_PREFIX.length);

/**
 * Browsers used to get one persistent partition per task; those directories are
 * never referenced again now that all browsers share one profile partition.
 * Best-effort removal of the stale on-disk data (cookies, caches) so it does
 * not accumulate in userData/Partitions.
 */
export async function cleanupLegacyBrowserPartitions(): Promise<void> {
  const partitionsDir = join(app.getPath('userData'), 'Partitions');
  let entries;
  try {
    entries = await readdir(partitionsDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith(LEGACY_DIR_PREFIX) || entry.name === PROFILE_DIR_NAME) continue;
    try {
      await rm(join(partitionsDir, entry.name), { recursive: true, force: true });
    } catch (error) {
      log.warn('Failed to remove legacy browser partition', { partition: entry.name, error });
    }
  }
}
