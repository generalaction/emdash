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
    featureAnnouncements: {
      getCurrent: vi.fn(),
      preview: vi.fn(),
    },
  },
}));

const manifest: FeatureAnnouncementManifest = {
  enabled: true,
  id: 'test-announcement',
  eyebrow: 'Now available',
  title: 'Test Feature',
  changelogUrl: 'https://emdash.sh/changelog',
};

describe('FeatureAnnouncementStore', () => {
  let settings: AnnouncementSettings;

  beforeEach(() => {
    settings = { initialized: false, dismissedIds: [] };
    vi.mocked(rpc.appSettings.get).mockImplementation(async () => settings);
    vi.mocked(rpc.appSettings.update).mockImplementation(async (_key, next) => {
      settings = next as AnnouncementSettings;
    });
    vi.mocked(rpc.featureAnnouncements.getCurrent).mockResolvedValue({
      success: true,
      data: null,
    });
    vi.mocked(rpc.featureAnnouncements.preview).mockResolvedValue({
      success: true,
      data: null,
    });
  });

  it('does not present dismissed announcements', () => {
    const store = new FeatureAnnouncementStore();
    store.setManifest(manifest);
    store.presentationReady = true;
    store.dismissForTest(manifest.id);

    expect(store.shouldPresent).toBe(false);
  });

  it('presents unseen announcements after dismissal state loads', () => {
    const store = new FeatureAnnouncementStore();
    store.setManifest(manifest);
    store.presentationReady = true;

    expect(store.shouldPresent).toBe(true);
  });

  it('persists dismissed announcement ids', async () => {
    const store = new FeatureAnnouncementStore();
    store.setManifest(manifest);
    await store.dismiss();

    expect(settings).toEqual({ initialized: true, dismissedIds: ['test-announcement'] });
  });

  it('does not persist preview dismissal', async () => {
    const store = new FeatureAnnouncementStore();
    store.setManifest(manifest);
    store.isPreview = true;
    await store.dismiss();

    expect(settings).toEqual({ initialized: false, dismissedIds: [] });
    expect(store.isPreview).toBe(false);
    expect(store.shouldPresent).toBe(false);
  });

  it('does not present before dismissal state is ready', () => {
    const store = new FeatureAnnouncementStore();
    store.setManifest(manifest);

    expect(store.shouldPresent).toBe(false);
  });

  it('initializes fresh-install dismissal state when manifest fetch fails', async () => {
    vi.mocked(rpc.featureAnnouncements.getCurrent).mockRejectedValue(new Error('offline'));

    const store = new FeatureAnnouncementStore();
    await store.start({ isFreshInstall: true });

    expect(store.status).toBe('error');
    expect(settings).toEqual({ initialized: true, dismissedIds: [] });
    expect(store.presentationReady).toBe(true);
  });
});
