import { FEATURE_ANNOUNCEMENT_DISMISSED_STORAGE_KEY } from '@shared/feature-announcements/constants';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Returns null when announcement tracking has never been initialized. */
export function readDismissedIds(storage: StorageLike = localStorage): Set<string> | null {
  try {
    const raw = storage.getItem(FEATURE_ANNOUNCEMENT_DISMISSED_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

export function writeDismissedIds(ids: Set<string>, storage: StorageLike = localStorage): void {
  try {
    storage.setItem(FEATURE_ANNOUNCEMENT_DISMISSED_STORAGE_KEY, JSON.stringify([...ids].sort()));
  } catch {
    // localStorage may be unavailable
  }
}

/**
 * Fresh installs shouldn't greet new users with a backlog of announcements.
 * Mark the current manifest as dismissed on first launch without showing it.
 */
export function initializeFreshInstallAnnouncement(options: {
  announcementId: string;
  isFreshInstall: boolean;
  storage?: StorageLike;
}): void {
  const storage = options.storage ?? localStorage;
  if (!options.isFreshInstall) return;
  if (readDismissedIds(storage) !== null) return;
  writeDismissedIds(new Set([options.announcementId]), storage);
}

export function markAnnouncementDismissed(id: string, storage: StorageLike = localStorage): void {
  const dismissed = readDismissedIds(storage) ?? new Set<string>();
  if (dismissed.has(id)) return;
  writeDismissedIds(new Set([...dismissed, id]), storage);
}

export function isAnnouncementDismissed(id: string, storage: StorageLike = localStorage): boolean {
  const dismissed = readDismissedIds(storage);
  if (dismissed === null) return false;
  return dismissed.has(id);
}
