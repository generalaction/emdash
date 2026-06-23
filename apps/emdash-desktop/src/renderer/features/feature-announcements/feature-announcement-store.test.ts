import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeatureAnnouncementStore } from '@renderer/features/feature-announcements/feature-announcement-store';
import { rpc } from '@renderer/lib/ipc';
import type { AnnouncementSettings } from '@shared/core/app-settings';
import type { FeatureAnnouncementManifest } from '@shared/feature-announcements/schema';

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    appSettings: {
      get: vi.fn(),
      update: vi.fn(),
    },
  },
}));

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
  let settings: AnnouncementSettings;

  beforeEach(() => {
    settings = { initialized: false, dismissedIds: [] };
    vi.mocked(rpc.appSettings.get).mockImplementation(async () => settings);
    vi.mocked(rpc.appSettings.update).mockImplementation(async (_key, next) => {
      settings = next as AnnouncementSettings;
    });
  });

  it('does not present dismissed announcements', () => {
    const store = new FeatureAnnouncementStore();
    store.setManifest(manifest);
    store.dismissForTest(manifest.id);

    expect(store.shouldPresent).toBe(false);
  });

  it('presents unseen announcements', () => {
    const store = new FeatureAnnouncementStore();
    store.setManifest(manifest);

    expect(store.shouldPresent).toBe(true);
  });

  it('persists dismissed announcement ids', async () => {
    const store = new FeatureAnnouncementStore();
    store.setManifest(manifest);
    await store.markPresented();

    expect(settings).toEqual({ initialized: true, dismissedIds: ['test-announcement'] });
  });

  it('does not persist preview presentation', async () => {
    const store = new FeatureAnnouncementStore();
    store.setManifest(manifest);
    store.isPreview = true;
    await store.markPresented();

    expect(settings).toEqual({ initialized: false, dismissedIds: [] });
  });
});
