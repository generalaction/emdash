import { useEffect, useMemo, useState } from 'react';
import {
  OPEN_IN_APPS,
  getResolvedIconPath,
  getResolvedLabel,
  type OpenInAppId,
  type PlatformKey,
} from '@shared/openInApps';

export interface UseOpenInAppsResult {
  icons: Partial<Record<OpenInAppId, string>>;
  labels: Partial<Record<OpenInAppId, string>>;
  availability: Record<string, boolean>;
  installedApps: typeof OPEN_IN_APPS;
  loading: boolean;
}

export function useOpenInApps(): UseOpenInAppsResult {
  const [icons, setIcons] = useState<Partial<Record<OpenInAppId, string>>>({});
  const [labels, setLabels] = useState<Partial<Record<OpenInAppId, string>>>({});
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [hiddenApps, setHiddenApps] = useState<OpenInAppId[]>([]);

  // Load platform-resolved icons and labels
  useEffect(() => {
    const load = async () => {
      let platform: PlatformKey = 'darwin';
      try {
        platform = ((await window.electronAPI?.getPlatform?.()) as PlatformKey) || 'darwin';
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

  // Load hidden apps from settings
  useEffect(() => {
    const loadHidden = async () => {
      try {
        const result = await window.electronAPI?.getSettings?.();
        if (result?.settings?.hiddenOpenInApps) {
          setHiddenApps(result.settings.hiddenOpenInApps as OpenInAppId[]);
        }
      } catch {}
    };
    void loadHidden();

    const handleChange = () => {
      void loadHidden();
    };
    window.addEventListener('hiddenOpenInAppsChanged', handleChange);
    return () => window.removeEventListener('hiddenOpenInAppsChanged', handleChange);
  }, []);

  // Fetch app availability
  useEffect(() => {
    const fetchAvailability = async () => {
      try {
        const apps = await window.electronAPI?.checkInstalledApps?.();
        if (apps) setAvailability(apps);
      } catch (e) {
        console.error('Failed to check installed apps:', e);
      } finally {
        setLoading(false);
      }
    };
    void fetchAvailability();
  }, []);

  // Filter to only installed and visible apps (return all while loading)
  const installedApps = useMemo(() => {
    if (loading) return OPEN_IN_APPS;
    return OPEN_IN_APPS.filter((app) => availability[app.id] && !hiddenApps.includes(app.id));
  }, [availability, loading, hiddenApps]);

  return { icons, labels, availability, installedApps, loading };
}
