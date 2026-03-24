import React, { useEffect, useMemo, useState } from 'react';
import type { ResolvedOpenInApp } from '@shared/openInApps';
import IntegrationRow from './IntegrationRow';
import { Switch } from './ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { useAppSettings } from '@/contexts/AppSettingsProvider';

export default function HiddenToolsSettingsCard() {
  const { settings, updateSettings, isLoading, isSaving } = useAppSettings();
  const [allApps, setAllApps] = useState<ResolvedOpenInApp[]>([]);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [availability, setAvailability] = useState<Record<string, boolean>>({});

  const hiddenApps: string[] = settings?.hiddenOpenInApps ?? [];

  useEffect(() => {
    const init = async () => {
      const apps: ResolvedOpenInApp[] = (await window.electronAPI?.getResolvedOpenInApps?.()) ?? [];
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

      try {
        const appsResult = await window.electronAPI?.checkInstalledApps?.();
        if (appsResult) setAvailability(appsResult);
      } catch {}
    };
    void init();
  }, []);

  const toggle = (appId: string, visible: boolean) => {
    const next = visible ? hiddenApps.filter((id) => id !== appId) : [...hiddenApps, appId];
    updateSettings({ hiddenOpenInApps: next });
    window.dispatchEvent(new Event('hiddenOpenInAppsChanged'));
  };

  // Sort: detected first, then alphabetically by label
  const sortedApps = useMemo(() => {
    return [...allApps].sort((a, b) => {
      const aDetected = availability[a.id] ?? a.alwaysAvailable ?? false;
      const bDetected = availability[b.id] ?? b.alwaysAvailable ?? false;
      if (aDetected && !bDetected) return -1;
      if (!aDetected && bDetected) return 1;
      return (labels[a.id] ?? a.label).localeCompare(labels[b.id] ?? b.label);
    });
  }, [allApps, availability, labels]);

  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-2">
      <div className="space-y-2">
        {sortedApps.map((app) => {
          const isDetected = availability[app.id] ?? app.alwaysAvailable ?? false;
          const isVisible = !hiddenApps.includes(app.id);
          const label = labels[app.id] ?? app.label;
          const icon = icons[app.id];
          const indicatorClass = isDetected ? 'bg-emerald-500' : 'bg-muted-foreground/50';
          const statusLabel = isDetected ? 'Detected' : 'Not detected';

          return (
            <IntegrationRow
              key={app.id}
              logoSrc={icon}
              name={label}
              status={isDetected ? 'connected' : 'missing'}
              showStatusPill={false}
              middle={
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className={`h-1.5 w-1.5 rounded-full ${indicatorClass}`} />
                  {statusLabel}
                </span>
              }
              rightExtra={
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Switch
                          checked={isVisible}
                          disabled={isLoading || isSaving}
                          onCheckedChange={(checked) => toggle(app.id, checked)}
                          aria-label={`${isVisible ? 'Hide' : 'Show'} ${label} in open menu`}
                        />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      {isVisible ? 'Hide from menu' : 'Show in menu'}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              }
            />
          );
        })}
      </div>
    </div>
  );
}
