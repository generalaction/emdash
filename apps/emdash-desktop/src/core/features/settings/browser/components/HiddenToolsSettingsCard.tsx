import { SettingsCard } from '@emdash/ui/react/patterns';
import { Button, Switch, Tooltip } from '@emdash/ui/react/primitives';
import { useMemo } from 'react';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import { useOpenInApps } from '@core/features/settings/api/browser/useOpenInApps';
import { OPEN_IN_APPS, type OpenInAppId } from '@core/primitives/open-in-apps/api/open-in-apps';
import IntegrationRow from './IntegrationRow';

export default function HiddenToolsSettingsCard() {
  const { value: openIn, update, isLoading, isSaving } = useAppSettingsKey('openIn');
  const { icons, labels, availability, hasDetectionProblem, refreshing, refresh } = useOpenInApps();

  const hiddenApps: OpenInAppId[] = openIn?.hidden ?? [];

  const toggle = (appId: OpenInAppId, visible: boolean) => {
    const next = visible ? hiddenApps.filter((id) => id !== appId) : [...hiddenApps, appId];
    update({ hidden: next });
  };

  const sortedApps = useMemo(() => {
    return Object.values(OPEN_IN_APPS).sort((a, b) => {
      const aDetected = availability[a.id] === 'detected';
      const bDetected = availability[b.id] === 'detected';
      if (aDetected && !bDetected) return -1;
      if (!aDetected && bDetected) return 1;
      return (labels[a.id] ?? a.label).localeCompare(labels[b.id] ?? b.label);
    });
  }, [availability, labels]);

  return (
    <SettingsCard>
      <div className="space-y-2">
        {hasDetectionProblem ? (
          <Button variant="secondary" size="sm" disabled={refreshing} onClick={refresh}>
            Retry
          </Button>
        ) : refreshing ? (
          <p role="status" className="px-3 text-sm text-foreground-muted">
            Checking applications…
          </p>
        ) : null}
        {sortedApps.map((app) => {
          const state = availability[app.id] ?? 'unknown';
          const isDetected = state === 'detected';
          const isVisible = isDetected && !hiddenApps.includes(app.id);
          const canToggleVisibility = isDetected;
          const label = labels[app.id] ?? app.label;
          const icon = icons[app.id];
          const indicatorClass = isDetected ? 'bg-foreground-success' : 'bg-foreground-passive/50';
          const statusLabel = {
            detected: 'Detected',
            'not-detected': 'Not detected',
            checking: null,
            unknown: 'Couldn’t check',
          }[state];
          const tooltipLabel = isDetected
            ? isVisible
              ? 'Hide from menu'
              : 'Show in menu'
            : state === 'not-detected'
              ? 'Install this tool to show it in menu'
              : undefined;

          return (
            <IntegrationRow
              key={app.id}
              logoSrc={icon}
              name={label}
              status={
                isDetected
                  ? 'connected'
                  : state === 'checking'
                    ? 'loading'
                    : state === 'unknown'
                      ? 'error'
                      : 'missing'
              }
              showStatusPill={false}
              middle={
                statusLabel && (
                  <span className="text-muted-foreground flex items-center gap-2 text-sm">
                    <span className={`h-1.5 w-1.5 rounded-full ${indicatorClass}`} />
                    {statusLabel}
                  </span>
                )
              }
              rightExtra={
                <Tooltip.Provider delay={150}>
                  <Tooltip.Root disabled={!tooltipLabel}>
                    <Tooltip.Trigger>
                      <span>
                        <Switch
                          checked={isVisible}
                          disabled={isLoading || isSaving || !canToggleVisibility}
                          onCheckedChange={(checked) => toggle(app.id, checked)}
                          aria-label={`${isVisible ? 'Hide' : 'Show'} ${label} in open menu`}
                        />
                      </span>
                    </Tooltip.Trigger>
                    {tooltipLabel && (
                      <Tooltip.Content side="top" className="text-xs">
                        {tooltipLabel}
                      </Tooltip.Content>
                    )}
                  </Tooltip.Root>
                </Tooltip.Provider>
              }
            />
          );
        })}
      </div>
    </SettingsCard>
  );
}
