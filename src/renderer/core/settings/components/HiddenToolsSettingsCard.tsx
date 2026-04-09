import { useMemo } from 'react';
import { OPEN_IN_APPS, type OpenInAppId } from '@shared/openInApps';
import { useAppSettingsKey } from '@renderer/core/settings/use-app-settings-key';
import { useOpenInApps } from '@renderer/hooks/useOpenInApps';
import { Switch } from '../../../components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../components/ui/tooltip';
import IntegrationRow from './IntegrationRow';

export default function HiddenToolsSettingsCard() {
  const { value: openIn, update, isLoading, isSaving } = useAppSettingsKey('openIn');
  const { icons, labels, availability } = useOpenInApps();

  const hiddenApps: OpenInAppId[] = openIn?.hidden ?? [];

  const toggle = (appId: OpenInAppId, visible: boolean) => {
    const next = visible ? hiddenApps.filter((id) => id !== appId) : [...hiddenApps, appId];
    update({ hidden: next });
  };

  const sortedApps = useMemo(() => {
    return Object.values(OPEN_IN_APPS).sort((a, b) => {
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
                <TooltipProvider delay={150}>
                  <Tooltip>
                    <TooltipTrigger>
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
