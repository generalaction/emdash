import { DropdownMenu, Tooltip, useToast } from '@emdash/ui/react/primitives';
import { ChevronDown } from 'lucide-react';
import React, { useCallback, useEffect, useMemo } from 'react';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import { useOpenInApps } from '@core/features/settings/api/browser/useOpenInApps';
import { getHostClient } from '@core/primitives/desktop-host/browser/host-client';
import { BoundShortcut } from '@core/primitives/keybindings/browser/shortcut';
import { log } from '@core/primitives/logging/browser/logger';
import {
  getAppById,
  isValidOpenInAppId,
  type OpenInAppId,
} from '@core/primitives/open-in-apps/api/open-in-apps';
import { openInCommandRegistry } from '@core/primitives/open-in-apps/browser/open-in-command-registry';
import { cn } from '@core/primitives/styling/browser/cn';

interface OpenInMenuProps {
  path: string;
  className?: string;
  borderless?: boolean;
  isRemote?: boolean;
  sshConnectionId?: string;
}

export const OpenInMenu: React.FC<OpenInMenuProps> = ({
  path,
  className,
  borderless = false,
  isRemote = false,
  sshConnectionId,
}) => {
  const { toast } = useToast();
  const { icons, labels, installedApps, availability, platform } = useOpenInApps();
  const { value: openIn, update } = useAppSettingsKey('openIn');

  const defaultApp: OpenInAppId | null =
    openIn?.default && isValidOpenInAppId(openIn.default) ? openIn.default : null;

  const persistPreferredApp = useCallback(
    (appId: OpenInAppId) => {
      update({ default: appId });
    },
    [update]
  );

  const triggerOpenIn = useCallback(
    async (appId: OpenInAppId) => {
      const label = labels[appId] || appId;
      try {
        const res = await (
          await getHostClient()
        ).openIn({
          app: appId,
          path,
          isRemote,
          sshConnectionId,
        });
        if (!res?.success) {
          toast.error(`Open in ${label} failed`, {
            description: res?.error || 'Application not available.',
          });
        }
      } catch (e: unknown) {
        log.warn('[open-in] Launch request failed', {
          appId,
          isRemote,
          error: e instanceof Error ? e.message : String(e),
        });
        toast.error(`Open in ${label} failed`, {
          description: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [isRemote, labels, path, sshConnectionId, toast]
  );

  const selectAndOpenApp = useCallback(
    (appId: OpenInAppId) => {
      persistPreferredApp(appId);
      void triggerOpenIn(appId);
    },
    [persistPreferredApp, triggerOpenIn]
  );

  const sortedApps = useMemo(() => {
    const availableApps = isRemote
      ? installedApps.filter(
          (app) => app.supportsRemote && (app.id !== 'terminal' || platform === 'darwin')
        )
      : installedApps;
    if (!defaultApp) return availableApps;
    return [...availableApps].sort((a, b) => {
      if (a.id === defaultApp) return -1;
      if (b.id === defaultApp) return 1;
      return 0;
    });
  }, [defaultApp, installedApps, isRemote, platform]);

  const menuApps = useMemo(
    () => sortedApps.filter((app) => availability[app.id] === 'detected'),
    [availability, sortedApps]
  );

  const buttonAppId = useMemo(() => {
    if (defaultApp && menuApps.some((app) => app.id === defaultApp)) {
      return defaultApp;
    }
    return menuApps[0]?.id;
  }, [defaultApp, menuApps]);

  const buttonAppLabel = buttonAppId ? (labels[buttonAppId] ?? buttonAppId) : null;

  useEffect(() => {
    if (!buttonAppId) return;
    return openInCommandRegistry.register({
      trigger: () => {
        void triggerOpenIn(buttonAppId);
      },
    });
  }, [buttonAppId, triggerOpenIn]);

  return (
    <div
      className={cn(
        'border border-border rounded-md h-6 flex items-center text-foreground-muted overflow-hidden',
        borderless && 'border-none',
        className
      )}
    >
      <Tooltip.Provider delay={0}>
        <Tooltip.Root>
          <Tooltip.Trigger
            className="flex min-w-0 flex-1"
            render={
              <button
                type="button"
                className={cn(
                  'group flex items-center w-full border-r border-border rounded-r-none px-2 text-xs transition-colors hover:bg-background-1 hover:text-foreground min-w-0',
                  borderless && 'border-none  pr-1'
                )}
                onClick={() => {
                  if (!buttonAppId) return;
                  void triggerOpenIn(buttonAppId);
                }}
                disabled={!buttonAppId}
                aria-label={buttonAppLabel ? `Open in ${buttonAppLabel}` : 'Open'}
              >
                {buttonAppId && icons[buttonAppId] && (
                  <img
                    src={icons[buttonAppId]}
                    alt={labels[buttonAppId] || buttonAppId}
                    className={`size-3.5 rounded ${
                      getAppById(buttonAppId)?.invertInDark ? 'emdark:invert' : ''
                    }`}
                  />
                )}
              </button>
            }
          />
          <Tooltip.Content side="bottom">
            <div className="flex flex-col gap-1">
              <span>Open in {buttonAppLabel || 'editor'}</span>
              <BoundShortcut command="app.openInEditor" variant="keycaps" />
            </div>
          </Tooltip.Content>
        </Tooltip.Root>
      </Tooltip.Provider>
      <DropdownMenu.Root>
        <Tooltip.Root>
          <Tooltip.Trigger
            render={
              <DropdownMenu.Trigger
                className="group flex size-6 shrink-0 items-center justify-center border-none bg-transparent transition-colors hover:bg-background-1 hover:text-foreground"
                aria-label="Open in options"
                disabled={menuApps.length === 0}
              >
                <ChevronDown className="size-3.5" />
              </DropdownMenu.Trigger>
            }
          ></Tooltip.Trigger>
          <Tooltip.Content side="bottom">Select open in app</Tooltip.Content>
        </Tooltip.Root>
        <DropdownMenu.Content align="end" sideOffset={6} width="content">
          <DropdownMenu.RadioGroup
            value={defaultApp ?? undefined}
            onValueChange={(value) => {
              if (isValidOpenInAppId(value)) selectAndOpenApp(value as OpenInAppId);
            }}
          >
            {menuApps.map((app) => (
              <DropdownMenu.RadioItem key={app.id} value={app.id}>
                {icons[app.id] && (
                  <img
                    src={icons[app.id]}
                    alt={labels[app.id] || app.label}
                    className={`h-4 w-4 rounded ${app.invertInDark ? 'emdark:invert' : ''}`}
                  />
                )}
                {labels[app.id] || app.label}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  );
};
