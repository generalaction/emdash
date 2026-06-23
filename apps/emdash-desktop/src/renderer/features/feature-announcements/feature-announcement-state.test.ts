import { describe, expect, it } from 'vitest';
import {
  initializeFreshInstallAnnouncement,
  isAnnouncementDismissed,
  markAnnouncementDismissed,
  readDismissedIds,
} from '@renderer/features/feature-announcements/feature-announcement-state';
import { FEATURE_ANNOUNCEMENT_DISMISSED_STORAGE_KEY } from '@shared/feature-announcements/constants';

function makeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    dump: () => Object.fromEntries(data),
  };
}

describe('feature announcement state', () => {
  it('marks the current announcement as dismissed on a fresh install', () => {
    const storage = makeStorage();
    initializeFreshInstallAnnouncement({
      announcementId: 'automations-2026-06',
      isFreshInstall: true,
      storage,
    });
    expect(isAnnouncementDismissed('automations-2026-06', storage)).toBe(true);
  });

  it('does not touch already-initialized state on a fresh-install flag', () => {
    const storage = makeStorage({
      [FEATURE_ANNOUNCEMENT_DISMISSED_STORAGE_KEY]: JSON.stringify(['older']),
    });
    initializeFreshInstallAnnouncement({
      announcementId: 'automations-2026-06',
      isFreshInstall: true,
      storage,
    });
    expect(isAnnouncementDismissed('automations-2026-06', storage)).toBe(false);
  });

  it('shows existing users unseen announcements', () => {
    const storage = makeStorage();
    initializeFreshInstallAnnouncement({
      announcementId: 'automations-2026-06',
      isFreshInstall: false,
      storage,
    });
    expect(isAnnouncementDismissed('automations-2026-06', storage)).toBe(false);
  });

  it('is idempotent when marking the same announcement twice', () => {
    const storage = makeStorage();
    markAnnouncementDismissed('newer', storage);
    markAnnouncementDismissed('newer', storage);
    expect(JSON.parse(storage.dump()[FEATURE_ANNOUNCEMENT_DISMISSED_STORAGE_KEY])).toEqual([
      'newer',
    ]);
  });

  it('treats corrupted storage as empty dismissed state', () => {
    const storage = makeStorage({ [FEATURE_ANNOUNCEMENT_DISMISSED_STORAGE_KEY]: 'not json{' });
    expect(readDismissedIds(storage)).toEqual(new Set());
  });
});
