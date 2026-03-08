import { useEffect, useMemo, useState } from 'react';
import {
  getResolvedIconPath,
  getResolvedLabel,
  OPEN_IN_APPS,
  type OpenInAppId,
  type PlatformKey,
} from '@shared/openInApps';
import { useAppSettings } from '@renderer/contexts/AppSettingsProvider';
import { rpc } from '../lib/ipc';

export interface UseOpenInAppsResult {
  icons: Partial<Record<OpenInAppId, string>>;
  labels: Partial<Record<OpenInAppId, string>>;
  availability: Record<string, boolean>;
  installedApps: typeof OPEN_IN_APPS;
  loading: boolean;
}

export function useOpenInApps(): UseOpenInAppsResult {
  const { settings, isLoading: settingsLoading } = useAppSettings();
  const [icons, setIcons] = useState<Partial<Record<OpenInAppId, string>>>({});
  const [labels, setLabels] = useState<Partial<Record<OpenInAppId, string>>>({});
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [availabilityLoading, setAvailabilityLoading] = useState(true);

  const loading = settingsLoading || availabilityLoading;

  // Load platform-resolved icons and labels
  useEffect(() => {
    const load = async () => {
      let platform: PlatformKey = 'darwin';
      try {
        platform = ((await rpc.app.getPlatform()) as unknown as PlatformKey) || 'darwin';
      } catch {}

      const loadedIcons: Partial<Record<OpenInAppId, string>> = {};
      const loadedLabels: Partial<Record<OpenInAppId, string>> = {};
      for (const app of OPEN_IN_APPS) {
        const iconPath = getResolvedIconPath(app, platform);
        loadedLabels[app.id] = getResolvedLabel(app, platform);
        try {
          loadedIcons[app.id] = new URL(`../../assets/images/${iconPath}`, import.meta.url).href;
        } catch (e) {
          console.error(`Failed to load icon for ${app.id}:`, e);
        }
      }
      setIcons(loadedIcons);
      setLabels(loadedLabels);
    };
    void load();
  }, []);

  // Fetch app availability
  useEffect(() => {
    const fetchAvailability = async () => {
      try {
        const apps = await rpc.app.checkInstalledApps();
        if (apps) setAvailability(apps as Record<string, boolean>);
      } catch (e) {
        console.error('Failed to check installed apps:', e);
      } finally {
        setAvailabilityLoading(false);
      }
    };
    void fetchAvailability();
  }, []);

  // Filter to only installed and visible apps (return all while loading)
  const installedApps = useMemo(() => {
    const hiddenApps: OpenInAppId[] = settings?.hiddenOpenInApps ?? [];
    if (loading) return OPEN_IN_APPS;
    return OPEN_IN_APPS.filter((app) => availability[app.id] && !hiddenApps.includes(app.id));
  }, [availability, loading, settings?.hiddenOpenInApps]);

  return { icons, labels, availability, installedApps, loading };
}
