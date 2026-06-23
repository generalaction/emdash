import { describe, expect, it } from 'vitest';
import {
  clearAnnouncementDismissal,
  initializeFreshInstallAnnouncement,
  markAnnouncementDismissed,
  readAnnouncementDismissalState,
} from '@renderer/features/feature-announcements/feature-announcement-state';
import type { AnnouncementSettings } from '@shared/core/app-settings';

function makeSettingsClient(
  initial: AnnouncementSettings = { initialized: false, dismissedIds: [] }
) {
  let settings = initial;
  return {
    get: async () => settings,
    update: async (next: AnnouncementSettings) => {
      settings = next;
    },
    read: () => settings,
  };
}

describe('feature announcement state', () => {
  it('marks the current announcement as dismissed on a fresh install', async () => {
    const client = makeSettingsClient();
    await initializeFreshInstallAnnouncement(
      {
        announcementId: 'automations-2026-06',
        isFreshInstall: true,
      },
      client
    );

    expect(client.read()).toEqual({
      initialized: true,
      dismissedIds: ['automations-2026-06'],
    });
  });

  it('initializes fresh installs even when no announcement is available', async () => {
    const client = makeSettingsClient();
    await initializeFreshInstallAnnouncement(
      {
        isFreshInstall: true,
      },
      client
    );

    expect(client.read()).toEqual({
      initialized: true,
      dismissedIds: [],
    });
  });

  it('does not touch already-initialized state on a fresh-install flag', async () => {
    const client = makeSettingsClient({ initialized: true, dismissedIds: ['older'] });
    await initializeFreshInstallAnnouncement(
      {
        announcementId: 'automations-2026-06',
        isFreshInstall: true,
      },
      client
    );

    expect(client.read()).toEqual({ initialized: true, dismissedIds: ['older'] });
  });

  it('shows existing users unseen announcements', async () => {
    const client = makeSettingsClient();
    await initializeFreshInstallAnnouncement(
      {
        announcementId: 'automations-2026-06',
        isFreshInstall: false,
      },
      client
    );

    expect(client.read()).toEqual({ initialized: false, dismissedIds: [] });
  });

  it('is idempotent when marking the same announcement twice', async () => {
    const client = makeSettingsClient();
    await markAnnouncementDismissed('newer', client);
    await markAnnouncementDismissed('newer', client);

    expect(client.read()).toEqual({ initialized: true, dismissedIds: ['newer'] });
  });

  it('clears a previously dismissed announcement id', async () => {
    const client = makeSettingsClient();
    await markAnnouncementDismissed('automations-2026-06', client);
    await clearAnnouncementDismissal('automations-2026-06', client);

    expect(client.read()).toEqual({ initialized: true, dismissedIds: [] });
  });

  it('normalizes stored dismissed ids', async () => {
    const client = makeSettingsClient({
      initialized: true,
      dismissedIds: ['z', '', 'a', 'z'],
    });

    await expect(readAnnouncementDismissalState(client)).resolves.toEqual({
      initialized: true,
      dismissedIds: ['a', 'z'],
    });
  });
});
