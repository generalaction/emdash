import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { isValidOpenInAppId, OPEN_IN_APPS, type OpenInAppId } from '@shared/openInApps';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useOpenInApps } from '../hooks/useOpenInApps';

const DEFAULT_APP: OpenInAppId = 'terminal';

const DefaultOpenInSettingsCard: React.FC = () => {
  const [defaultApp, setDefaultApp] = useState<OpenInAppId>(DEFAULT_APP);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const { icons, availability, loading: appsLoading } = useOpenInApps();

  const load = useCallback(async () => {
    try {
      const res = await window.electronAPI.getSettings();
      if (res?.success && res.settings?.defaultOpenInApp) {
        const app = res.settings.defaultOpenInApp;
        setDefaultApp(isValidOpenInAppId(app) ? app : DEFAULT_APP);
      }
    } catch {
      // Use default on error
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (app: OpenInAppId) => {
      const previousApp = defaultApp;
      setDefaultApp(app); // Optimistic update
      try {
        const res = await window.electronAPI.updateSettings({ defaultOpenInApp: app });
        if (res?.success) {
          // Notify other components of the change
          window.dispatchEvent(new CustomEvent('defaultOpenInAppChanged', { detail: app }));
        } else {
          // Revert on failure
          setDefaultApp(previousApp);
        }
      } catch {
        // Revert on error
        setDefaultApp(previousApp);
      }
    },
    [defaultApp]
  );

  // Sort apps: installed first, then uninstalled
  const sortedApps = useMemo(() => {
    return [...OPEN_IN_APPS].sort((a, b) => {
      const aInstalled = availability[a.id] ?? false;
      const bInstalled = availability[b.id] ?? false;
      if (aInstalled && !bInstalled) return -1;
      if (!aInstalled && bInstalled) return 1;
      return 0;
    });
  }, [availability]);

  // Find the selected app for display
  const selectedApp = OPEN_IN_APPS.find((app) => app.id === defaultApp);

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium text-foreground">Default open in app</p>
        <p className="text-sm text-muted-foreground">
          The application shown first when using "Open in".
        </p>
      </div>
      <div className="w-[183px] flex-shrink-0">
        <Select
          value={defaultApp}
          onValueChange={(value) => {
            if (isValidOpenInAppId(value)) {
              void save(value);
            }
          }}
          disabled={settingsLoading || appsLoading}
        >
          <SelectTrigger className="w-full">
            <SelectValue>
              {selectedApp && (
                <span className="flex items-center gap-2">
                  {icons[selectedApp.id] && (
                    <img
                      src={icons[selectedApp.id]}
                      alt={selectedApp.label}
                      className="h-4 w-4 rounded"
                    />
                  )}
                  <span>{selectedApp.label}</span>
                </span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {sortedApps.map((app) => {
              const isInstalled = availability[app.id] ?? false;
              return (
                <SelectItem
                  key={app.id}
                  value={app.id}
                  disabled={!isInstalled}
                  className={!isInstalled ? 'opacity-50' : ''}
                >
                  <span className="flex items-center gap-2">
                    {icons[app.id] && (
                      <img src={icons[app.id]} alt={app.label} className="h-4 w-4 rounded" />
                    )}
                    <span>{app.label}</span>
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};

export default DefaultOpenInSettingsCard;
