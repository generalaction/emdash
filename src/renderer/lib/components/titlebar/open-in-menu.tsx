import { useHotkey } from '@tanstack/react-hotkeys';
import { ChevronDown } from 'lucide-react';
import React, { useCallback, useMemo } from 'react';
import { getAppById, isValidOpenInAppId, type OpenInAppId } from '@shared/openInApps';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { getEffectiveHotkey } from '@renderer/lib/hooks/useKeyboardShortcuts';
import { useOpenInApps } from '@renderer/lib/hooks/useOpenInApps';
import { rpc } from '@renderer/lib/ipc';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/lib/ui/select';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';

interface OpenInMenuProps {
  path: string;
  isRemote?: boolean;
  sshConnectionId?: string | null;
  className?: string;
}

export const OpenInMenu: React.FC<OpenInMenuProps> = ({
  path,
  className,
  isRemote = false,
  sshConnectionId = null,
}) => {
  const { toast } = useToast();
  const { icons, labels, installedApps, availability, loading } = useOpenInApps();
  const { value: openIn, update } = useAppSettingsKey('openIn');
  const { value: keyboard } = useAppSettingsKey('keyboard');

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
          sshConnectionId: sshConnectionId ?? undefined,
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
    [labels, path, isRemote, sshConnectionId, toast]
  );

  const sortedApps = useMemo(() => {
    if (!defaultApp) return installedApps;
    return [...installedApps].sort((a, b) => {
      if (a.id === defaultApp) return -1;
      if (b.id === defaultApp) return 1;
      return 0;
    });
  }, [defaultApp, installedApps]);

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

  useHotkey(
    getEffectiveHotkey('openInEditor', keyboard),
    () => {
      if (!buttonAppId) return;
      void triggerOpenIn(buttonAppId);
    },
    { enabled: !!buttonAppId && !loading }
  );

  const shortenedPath = useMemo(() => path.split('/').slice(-2).join('/'), [path]);

  return (
    <div
      className={cn(
        'border border-border rounded-md h-6 flex items-center text-foreground-muted overflow-hidden',
        className
      )}
    >
      <TooltipProvider delay={0}>
        <Tooltip>
          <TooltipTrigger className="flex-1 flex min-w-0">
            <button
              type="button"
              className="group flex items-center w-full min-w-0 gap-1.5 border-r border-border truncate rounded-r-none px-2 text-xs transition-colors hover:bg-background-1 hover:text-foreground"
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
                    getAppById(buttonAppId)?.invertInDark ? 'dark:invert' : ''
                  }`}
                />
              )}
              <span>{shortenedPath}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <div className="flex flex-col gap-1">
              <span>Open in {buttonAppLabel || 'editor'}</span>
              <ShortcutHint settingsKey="openInEditor" />
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Select
        value={defaultApp ?? undefined}
        onValueChange={(value) => {
          if (isValidOpenInAppId(value)) {
            persistPreferredApp(value as OpenInAppId);
          }
        }}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <SelectTrigger
                showChevron={false}
                className="group shrink-0 size-6 border-none bg-transparent flex items-center justify-center transition-colors hover:bg-background-1 hover:text-foreground"
                aria-label="Open in options"
              >
                <ChevronDown className="size-3.5" />
              </SelectTrigger>
            }
          ></TooltipTrigger>
          <TooltipContent side="bottom">Select open in app</TooltipContent>
        </Tooltip>
        <SelectContent align="end" alignItemWithTrigger={false} sideOffset={6}>
          {menuApps.map((app) => {
            const isAvailable = loading ? availability[app.id] === true : true;
            return (
              <SelectItem key={app.id} value={app.id} disabled={!isAvailable}>
                {icons[app.id] && (
                  <img
                    src={icons[app.id]}
                    alt={labels[app.id] || app.label}
                    className={`h-4 w-4 rounded ${app.invertInDark ? 'dark:invert' : ''}`}
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
