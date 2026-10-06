import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import { getHostClient } from '@core/primitives/desktop-host/browser/host-client';
import { log } from '@core/primitives/logging/browser/logger';
import type {
  AppDetectionResults,
  AppDetectionStatus,
} from '@core/primitives/open-in-apps/api/app-detection';
import {
  getResolvedIconPath,
  getResolvedLabel,
  OPEN_IN_APPS,
  type OpenInAppConfig,
  type OpenInAppId,
  type PlatformKey,
} from '@core/primitives/open-in-apps/api/open-in-apps';

const iconModules = import.meta.glob('../../../../../assets/images/*', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function getIconUrl(iconPath: string): string | undefined {
  return iconModules[`../../../../../assets/images/${iconPath}`];
}

export interface UseOpenInAppsResult {
  icons: Partial<Record<OpenInAppId, string>>;
  labels: Partial<Record<OpenInAppId, string>>;
  availability: Record<string, AppDetectionStatus | 'checking'>;
  installedApps: OpenInAppConfig[];
  platform?: PlatformKey;
  loading: boolean;
  refreshing: boolean;
  hasDetectionProblem: boolean;
  refresh: () => void;
}

function supportsPlatform(app: OpenInAppConfig, platform: PlatformKey): boolean {
  return app.alwaysAvailable === true || Boolean(app.platforms[platform]);
}

export function useOpenInApps(): UseOpenInAppsResult {
  const { value: openIn, isLoading: settingsLoading } = useAppSettingsKey('openIn');

  const { data: platform, isLoading: platformLoading } = useQuery({
    queryKey: ['app', 'platform'],
    queryFn: async () => (await (await getHostClient()).getPlatform()) as PlatformKey,
    staleTime: Infinity,
  });

  const detection = useQuery({
    queryKey: ['app', 'installedApps'],
    queryFn: async (): Promise<AppDetectionResults> => {
      try {
        return await (await getHostClient()).checkInstalledApps();
      } catch (error) {
        log.warn('[open-in] Detection request failed', { error });
        throw error;
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const loading = settingsLoading || platformLoading || detection.isLoading;
  const availability = useMemo<UseOpenInAppsResult['availability']>(() => {
    return Object.fromEntries(
      Object.values(OPEN_IN_APPS).map((app) => [
        app.id,
        app.alwaysAvailable
          ? 'detected'
          : platform && !supportsPlatform(app, platform)
            ? 'not-detected'
            : (detection.data?.[app.id] ?? (detection.isLoading ? 'checking' : 'unknown')),
      ])
    );
  }, [detection.data, detection.isLoading, platform]);
  const hasDetectionProblem = detection.isError || Object.values(availability).includes('unknown');

  const labels = useMemo(() => {
    const result: Partial<Record<OpenInAppId, string>> = {};
    if (!platform) return result;
    for (const app of Object.values(OPEN_IN_APPS)) {
      result[app.id] = getResolvedLabel(app, platform);
    }
    return result;
  }, [platform]);

  const icons = useMemo(() => {
    const result: Partial<Record<OpenInAppId, string>> = {};
    if (!platform) return result;
    for (const app of Object.values(OPEN_IN_APPS)) {
      const iconPath = getResolvedIconPath(app, platform);
      const url = getIconUrl(iconPath);
      if (url) result[app.id] = url;
    }
    return result;
  }, [platform]);

  const installedApps = useMemo(() => {
    const hiddenApps: OpenInAppId[] = openIn?.hidden ?? [];
    if (!platform) return [];
    const platformApps = Object.values(OPEN_IN_APPS).filter(
      (app) => supportsPlatform(app, platform) && !hiddenApps.includes(app.id)
    );
    return platformApps.filter((app) => availability[app.id] !== 'not-detected');
  }, [availability, openIn?.hidden, platform]);

  return {
    icons,
    labels,
    availability,
    installedApps,
    platform,
    loading,
    refreshing: detection.isFetching,
    hasDetectionProblem,
    refresh: () => {
      void detection.refetch();
    },
  };
}
