import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  getResolvedIconPath,
  getResolvedLabel,
  OPEN_IN_APPS,
  type OpenInAppConfig,
  type OpenInAppId,
  type PlatformKey,
} from '@shared/openInApps';
import { useAppSettingsKey } from '@renderer/core/app/use-app-settings-key';
import { rpc } from '../core/ipc';

const iconModules = import.meta.glob('../../assets/images/*', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function getIconUrl(iconPath: string): string | undefined {
  return iconModules[`../../assets/images/${iconPath}`];
}

export interface UseOpenInAppsResult {
  icons: Partial<Record<OpenInAppId, string>>;
  labels: Partial<Record<OpenInAppId, string>>;
  availability: Record<string, boolean>;
  installedApps: OpenInAppConfig[];
  loading: boolean;
}

export function useOpenInApps(): UseOpenInAppsResult {
  const { value: openIn, isLoading: settingsLoading } = useAppSettingsKey('openIn');

  const { data: platform = 'darwin' } = useQuery({
    queryKey: ['app', 'platform'],
    queryFn: () => rpc.app.getPlatform() as Promise<PlatformKey>,
    staleTime: Infinity,
  });

  const { data: availability = {}, isLoading: availabilityLoading } = useQuery({
    queryKey: ['app', 'installedApps'],
    queryFn: async () => {
      const apps = await rpc.app.checkInstalledApps();
      return (apps ?? {}) as Record<string, boolean>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const loading = settingsLoading || availabilityLoading;

  const labels = useMemo(() => {
    const result: Partial<Record<OpenInAppId, string>> = {};
    for (const app of Object.values(OPEN_IN_APPS)) {
      result[app.id] = getResolvedLabel(app, platform);
    }
    return result;
  }, [platform]);

  const icons = useMemo(() => {
    const result: Partial<Record<OpenInAppId, string>> = {};
    for (const app of Object.values(OPEN_IN_APPS)) {
      const iconPath = getResolvedIconPath(app, platform);
      const url = getIconUrl(iconPath);
      if (url) result[app.id] = url;
    }
    return result;
  }, [platform]);

  const installedApps = useMemo(() => {
    const hiddenApps: OpenInAppId[] = openIn?.hidden ?? [];
    if (loading) return Object.values(OPEN_IN_APPS);
    return Object.values(OPEN_IN_APPS).filter(
      (app) => availability[app.id] && !hiddenApps.includes(app.id)
    );
  }, [availability, loading, openIn?.hidden]);

  return { icons, labels, availability, installedApps, loading };
}
