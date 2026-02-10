import { useEffect, useMemo, useState } from 'react';
import { OPEN_IN_APPS, type OpenInAppId } from '@shared/openInApps';

export interface UseOpenInAppsResult {
  icons: Partial<Record<OpenInAppId, string>>;
  availability: Record<string, boolean>;
  installedApps: typeof OPEN_IN_APPS;
  loading: boolean;
}

export function useOpenInApps(): UseOpenInAppsResult {
  const [icons, setIcons] = useState<Partial<Record<OpenInAppId, string>>>({});
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  // Load icons
  useEffect(() => {
    const loadIcons = async () => {
      const loadedIcons: Partial<Record<OpenInAppId, string>> = {};
      for (const app of OPEN_IN_APPS) {
        try {
          loadedIcons[app.id] = new URL(
            `../../assets/images/${app.iconPath}`,
            import.meta.url
          ).href;
        } catch (e) {
          console.error(`Failed to load icon for ${app.id}:`, e);
        }
      }
      setIcons(loadedIcons);
    };
    void loadIcons();
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

  // Filter to only installed apps (return all while loading)
  const installedApps = useMemo(() => {
    if (loading) return OPEN_IN_APPS;
    return OPEN_IN_APPS.filter((app) => availability[app.id]);
  }, [availability, loading]);

  return { icons, availability, installedApps, loading };
}
