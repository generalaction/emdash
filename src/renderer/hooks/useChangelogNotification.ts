import { useAppContext } from '@/contexts/AppContextProvider';
import { useAppSettings } from '@/contexts/AppSettingsProvider';
import { rpc } from '@/lib/rpc';
import {
  compareChangelogVersions,
  normalizeChangelogVersion,
  type ChangelogEntry,
} from '@shared/changelog';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

function createFallbackEntry(version: string): ChangelogEntry {
  return {
    version,
    title: `Release highlights for Emdash v${version}`,
    summary: `See what changed in Emdash v${version}.`,
    content: `See what changed in Emdash v${version}.`,
  };
}

function selectVersion(
  installedVersion: string | null,
  availableVersion: string | null,
  dismissedVersions: string[]
): string | null {
  const visibleInstalled =
    installedVersion && !dismissedVersions.includes(installedVersion) ? installedVersion : null;
  const visibleAvailable =
    availableVersion && !dismissedVersions.includes(availableVersion) ? availableVersion : null;

  if (visibleInstalled && visibleAvailable) {
    return compareChangelogVersions(visibleAvailable, visibleInstalled) >= 0
      ? visibleAvailable
      : visibleInstalled;
  }

  return visibleAvailable ?? visibleInstalled ?? null;
}

export function useChangelogNotification() {
  const { appVersion } = useAppContext();
  const { settings, updateSettings } = useAppSettings();
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    window.electronAPI
      .getUpdateState?.()
      .then((result) => {
        if (!mounted || !result?.success) return;
        setAvailableVersion(normalizeChangelogVersion(result.data?.availableVersion));
      })
      .catch(() => {});

    const off = window.electronAPI?.onUpdateEvent?.((event) => {
      if (event.type === 'available') {
        setAvailableVersion(normalizeChangelogVersion(event.payload?.version));
      }
    });

    return () => {
      mounted = false;
      off?.();
    };
  }, []);

  const dismissedVersions = settings?.changelog?.dismissedVersions ?? [];
  const installedVersion = normalizeChangelogVersion(appVersion);
  const notificationVersion = useMemo(
    () => selectVersion(installedVersion, availableVersion, dismissedVersions),
    [installedVersion, availableVersion, dismissedVersions]
  );

  const { data } = useQuery({
    queryKey: ['changelog', notificationVersion],
    enabled: Boolean(notificationVersion),
    staleTime: 60 * 60 * 1000,
    queryFn: async () =>
      rpc.changelog.getLatestEntry({ version: notificationVersion ?? undefined }),
  });

  const entry = useMemo(
    () => (notificationVersion ? (data ?? createFallbackEntry(notificationVersion)) : null),
    [data, notificationVersion]
  );

  const dismiss = useCallback(() => {
    if (!notificationVersion) return;

    const nextDismissedVersions = [...new Set([...dismissedVersions, notificationVersion])];
    updateSettings({
      changelog: {
        dismissedVersions: nextDismissedVersions,
      },
    });
  }, [dismissedVersions, notificationVersion, updateSettings]);

  return {
    entry,
    isVisible: Boolean(entry),
    dismiss,
  };
}
