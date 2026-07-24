import { ChevronDown } from 'lucide-react';
import React, { useCallback, useEffect, useMemo } from 'react';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import {
  getAppById,
  isValidOpenInAppId,
  type OpenInAppId,
} from '@core/primitives/open-in-apps/api/open-in-apps';
import { cn } from '@core/primitives/ui/browser/cn';
import { openInCommandRegistry } from '@core/primitives/ui/browser/components/titlebar/open-in-command-registry';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@core/primitives/ui/browser/select';
import { BoundShortcut } from '@core/primitives/ui/browser/shortcut';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@core/primitives/ui/browser/tooltip';
import { useToast } from '@core/primitives/ui/browser/use-toast';
import { useOpenInApps } from '@renderer/lib/hooks/useOpenInApps';
import { rpc } from '@renderer/lib/runtime/desktop-host-client';

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
  const { icons, labels, installedApps, availability, platform, loading } = useOpenInApps();
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
        const res = await rpc.app.openIn({
          app: appId,
          path,
          isRemote,
          sshConnectionId,
        });
        if (!res?.success) {
          toast({
            title: `Open in ${label} failed`,
            description: res?.error || 'Application not available.',
            variant: 'destructive',
          });
        }
      } catch (e: unknown) {
        toast({
          title: `Open in ${label} failed`,
          description: e instanceof Error ? e.message : String(e),
          variant: 'destructive',
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
    () => sortedApps.filter((app) => !app.hideIfUnavailable || availability[app.id]),
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
    if (!buttonAppId || loading) return;
    return openInCommandRegistry.register({
      trigger: () => {
        void triggerOpenIn(buttonAppId);
      },
    });
  }, [buttonAppId, loading, triggerOpenIn]);

  return (
    <div
      className={cn(
        'border border-border rounded-md h-6 flex items-center text-foreground-muted overflow-hidden',
        borderless && 'border-none',
        className
      )}
    >
      <TooltipProvider delay={0}>
        <Tooltip>
          <TooltipTrigger className="flex min-w-0 flex-1">
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
              disabled={!buttonAppId || loading}
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
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <div className="flex flex-col gap-1">
              <span>Open in {buttonAppLabel || 'editor'}</span>
              <BoundShortcut command="app.openInEditor" variant="keycaps" />
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Select
        value={defaultApp ?? undefined}
        onValueChange={(value) => {
          if (isValidOpenInAppId(value)) {
            selectAndOpenApp(value as OpenInAppId);
          }
        }}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <SelectTrigger
                showChevron={false}
                className="group flex size-6 shrink-0 items-center justify-center border-none bg-transparent transition-colors hover:bg-background-1 hover:text-foreground"
                aria-label="Open in options"
              >
                <ChevronDown className="size-3.5" />
              </SelectTrigger>
            }
          ></TooltipTrigger>
          <TooltipContent side="bottom">Select open in app</TooltipContent>
        </Tooltip>
        <SelectContent align="end" alignItemWithTrigger={false} sideOffset={6} className="w-max">
          {menuApps.map((app) => {
            const isAvailable = loading
              ? availability[app.id] === true
              : availability[app.id] !== false;
            return (
              <SelectItem key={app.id} value={app.id} disabled={!isAvailable}>
                {icons[app.id] && (
                  <img
                    src={icons[app.id]}
                    alt={labels[app.id] || app.label}
                    className={`h-4 w-4 rounded ${app.invertInDark ? 'emdark:invert' : ''}`}
                  />
                )}
                {labels[app.id] || app.label}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
};
