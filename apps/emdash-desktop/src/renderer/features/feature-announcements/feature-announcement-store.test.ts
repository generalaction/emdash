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
    vi.mocked(rpc.featureAnnouncements.getCurrent).mockResolvedValue({
      success: true,
      data: null,
    });
    vi.mocked(rpc.featureAnnouncements.preview).mockResolvedValue({
      success: true,
      data: null,
    });
  });

  it('does not show dismissed announcements in the sidebar', () => {
    const store = new FeatureAnnouncementStore();
    store.setManifest(manifest);
    store.setStatus('ready');
    store.dismissForTest(manifest.id);

    expect(store.shouldShowInSidebar).toBe(false);
  });

  it('shows unseen announcements in the sidebar', () => {
    const store = new FeatureAnnouncementStore();
    store.setManifest(manifest);
    store.setStatus('ready');

    expect(store.shouldShowInSidebar).toBe(true);
  });

  it('persists dismissed announcement ids', async () => {
    const store = new FeatureAnnouncementStore();
    store.setManifest(manifest);
    store.setStatus('ready');
    await store.dismiss();

    expect(settings).toEqual({ initialized: true, dismissedIds: ['test-announcement'] });
  });

  it('does not persist preview dismissal', async () => {
    const store = new FeatureAnnouncementStore();
    store.setManifest(manifest);
    store.setStatus('ready');
    store.isPreview = true;
    await store.dismiss();

    expect(store.shouldShowInSidebar).toBe(false);
    expect(settings).toEqual({ initialized: false, dismissedIds: [] });
  });

  it('initializes fresh-install dismissal state when manifest fetch fails', async () => {
    vi.mocked(rpc.featureAnnouncements.getCurrent).mockRejectedValue(new Error('offline'));

    const store = new FeatureAnnouncementStore();
    await store.start({ isFreshInstall: true });

    expect(store.status).toBe('error');
    expect(settings).toEqual({ initialized: true, dismissedIds: [] });
  });
});
