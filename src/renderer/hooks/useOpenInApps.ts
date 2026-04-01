import { useEffect, useMemo, useState } from 'react';
import type { ResolvedOpenInApp } from '@shared/openInApps';
import { useAppSettings } from '@/contexts/AppSettingsProvider';

export interface UseOpenInAppsResult {
  icons: Record<string, string>;
  labels: Record<string, string>;
  availability: Record<string, boolean>;
  installedApps: ResolvedOpenInApp[];
  loading: boolean;
}

export function useOpenInApps({
  isRemote = false,
}: { isRemote?: boolean } = {}): UseOpenInAppsResult {
  const { settings, isLoading: settingsLoading } = useAppSettings();
  const [allApps, setAllApps] = useState<ResolvedOpenInApp[]>([]);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [appsListLoading, setAppsListLoading] = useState(true);
  const [availabilityLoading, setAvailabilityLoading] = useState(true);

  const loading = settingsLoading || appsListLoading || availabilityLoading;

  // Stable key to detect when customOpenInApps changes
  const customAppsKey = JSON.stringify((settings?.customOpenInApps ?? []).map((c) => c.id).sort());

  // Load resolved apps, icons, and labels — refetch when custom tools change
  useEffect(() => {
    const load = async () => {
      try {
        const apps: ResolvedOpenInApp[] =
          (await window.electronAPI?.getResolvedOpenInApps?.()) ?? [];
        setAllApps(apps);

        const loadedIcons: Record<string, string> = {};
        const loadedLabels: Record<string, string> = {};

        for (const app of apps) {
          loadedLabels[app.id] = app.label;

          if (app.iconIsCustomPath && app.iconPath) {
            try {
              const dataUri = await window.electronAPI?.getCustomToolIcon?.(app.iconPath);
              if (dataUri) loadedIcons[app.id] = dataUri;
            } catch {}
          } else if (app.iconPath) {
            try {
              loadedIcons[app.id] = new URL(
                `../../assets/images/${app.iconPath}`,
                import.meta.url
              ).href;
            } catch {}
          }
        }

        setIcons(loadedIcons);
        setLabels(loadedLabels);
      } catch (e) {
        console.error('Failed to load resolved open-in apps:', e);
      } finally {
        setAppsListLoading(false);
      }
    };
    void load();
  }, [customAppsKey]);

  // Fetch app availability
  useEffect(() => {
    const fetchAvailability = async () => {
      try {
        const apps = await window.electronAPI?.checkInstalledApps?.();
        if (apps) setAvailability(apps);
      } catch (e) {
        console.error('Failed to check installed apps:', e);
      } finally {
        setAvailabilityLoading(false);
      }
    };
    void fetchAvailability();
  }, [customAppsKey]);

  // Filter to only installed and visible apps (return all while loading)
  const installedApps = useMemo(() => {
    const hiddenApps: string[] = settings?.hiddenOpenInApps ?? [];
    const workspaceApps = allApps.filter((app) => !isRemote || app.supportsRemote);
    if (loading) return workspaceApps;
    return workspaceApps.filter(
      (app) => (availability[app.id] || app.alwaysAvailable) && !hiddenApps.includes(app.id)
    );
  }, [allApps, availability, isRemote, loading, settings?.hiddenOpenInApps]);

  return { icons, labels, availability, installedApps, loading };
}
