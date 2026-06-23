import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeatureAnnouncementStore } from '@renderer/features/feature-announcements/feature-announcement-store';
import { FEATURE_ANNOUNCEMENT_DISMISSED_STORAGE_KEY } from '@shared/feature-announcements/constants';
import type { FeatureAnnouncementManifest } from '@shared/feature-announcements/schema';

const manifest: FeatureAnnouncementManifest = {
  enabled: true,
  id: 'test-announcement',
  eyebrow: 'Now available',
  title: 'Test Feature',
  changelogUrl: 'https://emdash.sh/changelog',
  features: [
    {
      icon: 'sparkles',
      title: 'Something new',
      description: 'A highlighted capability.',
    },
  ],
};

describe('FeatureAnnouncementStore', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      clear: vi.fn(() => storage.clear()),
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      removeItem: vi.fn((key: string) => storage.delete(key)),
    });
  });

  it('hides dismissed announcements', () => {
    const store = new FeatureAnnouncementStore();
    store.setManifest(manifest);
    store.dismiss();

    expect(store.visibleManifest).toBeNull();
  });

  it('shows preview announcements even when dismissed', () => {
    const store = new FeatureAnnouncementStore();
    store.setManifest(manifest);
    store.dismiss();
    store.preview(manifest);

    expect(store.visibleManifest).toEqual(manifest);
  });

  it('persists dismissed announcement ids', () => {
    const store = new FeatureAnnouncementStore();
    store.setManifest(manifest);
    store.dismiss();

    expect(localStorage.getItem(FEATURE_ANNOUNCEMENT_DISMISSED_STORAGE_KEY)).toBe(
      JSON.stringify(['test-announcement'])
    );
  });

  it('resolves known CTA views', () => {
    const store = new FeatureAnnouncementStore();
    expect(store.resolveCtaView('automations')).toBe('automations');
    expect(store.resolveCtaView('unknown-view')).toBeNull();
  });
});
