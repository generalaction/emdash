import React, { useEffect, useMemo, useState } from 'react';
import {
  OPEN_IN_APPS,
  getResolvedIconPath,
  getResolvedLabel,
  type OpenInAppId,
  type PlatformKey,
} from '@shared/openInApps';
import IntegrationRow from './IntegrationRow';
import { Switch } from './ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

export default function HiddenToolsSettingsCard() {
  const [hiddenApps, setHiddenApps] = useState<OpenInAppId[]>([]);
  const [icons, setIcons] = useState<Partial<Record<OpenInAppId, string>>>({});
  const [labels, setLabels] = useState<Partial<Record<OpenInAppId, string>>>({});
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
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
        } catch {}
      }
      setIcons(loadedIcons);
      setLabels(loadedLabels);

      try {
        const [settingsResult, appsResult] = await Promise.all([
          window.electronAPI?.getSettings?.(),
          window.electronAPI?.checkInstalledApps?.(),
        ]);
        if (settingsResult?.settings?.hiddenOpenInApps) {
          setHiddenApps(settingsResult.settings.hiddenOpenInApps as OpenInAppId[]);
        }
        if (appsResult) {
          setAvailability(appsResult);
        }
      } catch {}

      setLoading(false);
    };
    void init();
  }, []);

  const toggle = async (appId: OpenInAppId, visible: boolean) => {
    const next = visible ? hiddenApps.filter((id) => id !== appId) : [...hiddenApps, appId];
    setHiddenApps(next);
    try {
      await window.electronAPI?.updateSettings?.({ hiddenOpenInApps: next });
      window.dispatchEvent(new Event('hiddenOpenInAppsChanged'));
    } catch (e) {
      console.error('Failed to update hidden tools setting:', e);
    }
  };

  // Sort: detected first, then alphabetically by label
  const sortedApps = useMemo(() => {
    return [...OPEN_IN_APPS].sort((a, b) => {
      const aDetected = availability[a.id] ?? a.alwaysAvailable ?? false;
      const bDetected = availability[b.id] ?? b.alwaysAvailable ?? false;
      if (aDetected && !bDetected) return -1;
      if (!aDetected && bDetected) return 1;
      return (labels[a.id] ?? a.label).localeCompare(labels[b.id] ?? b.label);
    });
  }, [availability, labels]);

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
                          disabled={loading}
                          onCheckedChange={(checked) => void toggle(app.id, checked)}
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
