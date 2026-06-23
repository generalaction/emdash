import type { AnnouncementSettings } from '@shared/core/app-settings';

type AnnouncementSettingsClient = {
  get: () => Promise<AnnouncementSettings>;
  update: (settings: AnnouncementSettings) => Promise<void>;
};

const appSettingsClient: AnnouncementSettingsClient = {
  get: async () => {
    const { rpc } = await import('@renderer/lib/ipc');
    return rpc.appSettings.get('announcements') as Promise<AnnouncementSettings>;
  },
  update: async (settings) => {
    const { rpc } = await import('@renderer/lib/ipc');
    return rpc.appSettings.update('announcements', settings);
  },
};

function normalizeDismissedIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => id.length > 0))].sort();
}

export async function readAnnouncementDismissalState(
  client: AnnouncementSettingsClient = appSettingsClient
): Promise<AnnouncementSettings> {
  const settings = await client.get();
  return {
    initialized: settings.initialized,
    dismissedIds: normalizeDismissedIds(settings.dismissedIds),
  };
}

export async function writeAnnouncementDismissalState(
  settings: AnnouncementSettings,
  client: AnnouncementSettingsClient = appSettingsClient
): Promise<void> {
  await client.update({
    initialized: settings.initialized,
    dismissedIds: normalizeDismissedIds(settings.dismissedIds),
  });
}

/**
 * Fresh installs shouldn't greet new users with a backlog of announcements.
 * Mark the current manifest as dismissed on first launch without showing it.
 */
export async function initializeFreshInstallAnnouncement(
  options: {
    announcementId?: string;
    isFreshInstall: boolean;
  },
  client: AnnouncementSettingsClient = appSettingsClient
): Promise<void> {
  if (!options.isFreshInstall) return;

  const settings = await readAnnouncementDismissalState(client);
  if (settings.initialized) return;

  await writeAnnouncementDismissalState(
    {
      initialized: true,
      dismissedIds: options.announcementId ? [options.announcementId] : [],
    },
    client
  );
}

export async function markAnnouncementDismissed(
  id: string,
  client: AnnouncementSettingsClient = appSettingsClient
): Promise<void> {
  const settings = await readAnnouncementDismissalState(client);
  if (settings.initialized && settings.dismissedIds.includes(id)) return;

  await writeAnnouncementDismissalState(
    {
      initialized: true,
      dismissedIds: [...settings.dismissedIds, id],
    },
    client
  );
}

export async function clearAnnouncementDismissal(
  id: string,
  client: AnnouncementSettingsClient = appSettingsClient
): Promise<void> {
  const settings = await readAnnouncementDismissalState(client);
  if (!settings.dismissedIds.includes(id)) return;

  await writeAnnouncementDismissalState(
    {
      initialized: true,
      dismissedIds: settings.dismissedIds.filter((dismissedId) => dismissedId !== id),
    },
    client
  );
}
