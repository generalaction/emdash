import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import { Button } from '../ui/button';
import { useToast } from '@/hooks/use-toast';
import { getAppById, isValidOpenInAppId, type OpenInAppId } from '@shared/openInApps';
import { useOpenInApps } from '../../hooks/useOpenInApps';

interface OpenInMenuProps {
  path: string;
  align?: 'left' | 'right';
  isRemote?: boolean;
  sshConnectionId?: string | null;
  isActive?: boolean;
}

const menuItemBase =
  'flex w-full select-none items-center gap-2 rounded px-2.5 py-2 text-sm transition-colors cursor-pointer hover:bg-accent hover:text-accent-foreground';

const OpenInMenu: React.FC<OpenInMenuProps> = ({
  path,
  align = 'right',
  isRemote = false,
  sshConnectionId = null,
  isActive = true,
}) => {
  const [open, setOpen] = React.useState(false);
  const [defaultApp, setDefaultApp] = React.useState<OpenInAppId | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const shouldReduceMotion = useReducedMotion();
  const { toast } = useToast();
  const { icons, labels, installedApps, availability, loading } = useOpenInApps();

  // Fetch default app setting on mount and listen for changes
  React.useEffect(() => {
    const fetchDefaultApp = async () => {
      try {
        const res = await window.electronAPI?.getSettings?.();
        if (res?.success && res.settings?.defaultOpenInApp) {
          const app = res.settings.defaultOpenInApp;
          if (isValidOpenInAppId(app)) {
            // Do not overwrite a newer in-memory selection from user interaction.
            setDefaultApp((prev) => prev ?? app);
          }
        }
      } catch (e) {
        console.error('Failed to fetch default open in app:', e);
      }
    };
    void fetchDefaultApp();

    // Listen for changes from settings
    const handleChange = (e: CustomEvent<OpenInAppId>) => {
      if (isValidOpenInAppId(e.detail)) {
        setDefaultApp(e.detail);
      }
    };
    window.addEventListener('defaultOpenInAppChanged', handleChange as EventListener);
    return () => {
      window.removeEventListener('defaultOpenInAppChanged', handleChange as EventListener);
    };
  }, []);

  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const persistPreferredApp = React.useCallback(async (appId: OpenInAppId) => {
    setDefaultApp(appId);
    window.dispatchEvent(new CustomEvent('defaultOpenInAppChanged', { detail: appId }));
    try {
      await window.electronAPI?.updateSettings?.({ defaultOpenInApp: appId });
    } catch (e) {
      console.error('Failed to persist preferred open in app:', e);
    }
  }, []);

  const callOpen = React.useCallback(
    async (appId: OpenInAppId) => {
      const label = labels[appId] || appId;

      void import('../../lib/telemetryClient').then(({ captureTelemetry }) => {
        captureTelemetry('toolbar_open_in_selected', { app: appId });
      });
      try {
        const res = await window.electronAPI?.openIn?.({
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
      } catch (e: any) {
        toast({
          title: `Open in ${label} failed`,
          description: e?.message || String(e),
          variant: 'destructive',
        });
      }
      setOpen(false);
    },
    [labels, path, isRemote, sshConnectionId, toast]
  );

  // Sort installed apps with default first
  const sortedApps = React.useMemo(() => {
    if (!defaultApp) return installedApps;
    return [...installedApps].sort((a, b) => {
      if (a.id === defaultApp) return -1;
      if (b.id === defaultApp) return 1;
      return 0;
    });
  }, [defaultApp, installedApps]);

  const menuApps = React.useMemo(
    () => sortedApps.filter((app) => !app.hideIfUnavailable || availability[app.id]),
    [availability, sortedApps]
  );

  // Primary click app: persisted app first, otherwise first available entry.
  const buttonAppId = React.useMemo(() => {
    if (defaultApp && menuApps.some((app) => app.id === defaultApp)) {
      return defaultApp;
    }
    return menuApps[0]?.id;
  }, [defaultApp, menuApps]);

  const buttonAppLabel = buttonAppId ? (labels[buttonAppId] ?? buttonAppId) : null;

  React.useEffect(() => {
    if (!isActive) return;
    const handleOpenInEditorEvent = () => {
      if (buttonAppId) {
        void callOpen(buttonAppId);
      }
    };
    window.addEventListener('emdash:open-in-editor', handleOpenInEditorEvent);
    return () => window.removeEventListener('emdash:open-in-editor', handleOpenInEditorEvent);
  }, [isActive, buttonAppId, callOpen]);

  return (
    <div ref={containerRef} className="relative">
      <div className="flex min-w-0">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="group h-7 min-w-0 gap-1.5 truncate rounded-r-none pl-2 pr-0.5 text-[13px] font-medium leading-none text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground"
          onClick={() => {
            if (!buttonAppId) return;
            void callOpen(buttonAppId);
          }}
          disabled={!buttonAppId || loading}
          aria-label={buttonAppLabel ? `Open in ${buttonAppLabel}` : 'Open'}
          title="Open in… ⌘O"
        >
          {buttonAppId && icons[buttonAppId] && (
            <img
              src={icons[buttonAppId]}
              alt={labels[buttonAppId] || buttonAppId}
              className={`h-4 w-4 rounded ${
                getAppById(buttonAppId)?.invertInDark ? 'dark:invert' : ''
              }`}
            />
          )}
          <span>Open</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={[
            'group h-7 rounded-l-none px-1 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground',
            open ? 'text-foreground' : '',
          ].join(' ')}
          onClick={() => {
            const newState = !open;
            void import('../../lib/telemetryClient').then(({ captureTelemetry }) => {
              captureTelemetry('toolbar_open_in_menu_clicked', {
                state: newState ? 'open' : 'closed',
              });
            });
            setOpen(newState);
          }}
          aria-expanded={open}
          aria-haspopup
          aria-label="Open in options"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </Button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            className={[
              'absolute z-50 mt-1 min-w-[180px] rounded-md border border-border bg-popover p-1 shadow-md',
              align === 'right' ? 'right-0' : 'left-0',
            ].join(' ')}
            style={{ transformOrigin: align === 'right' ? 'top right' : 'top left' }}
            initial={shouldReduceMotion ? false : { opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={
              shouldReduceMotion
                ? { opacity: 1, y: 0, scale: 1 }
                : { opacity: 0, y: 4, scale: 0.98 }
            }
            transition={
              shouldReduceMotion ? { duration: 0 } : { duration: 0.16, ease: [0.22, 1, 0.36, 1] }
            }
          >
            {menuApps.map((app) => {
              // While loading, disable apps that aren't confirmed installed
              const isAvailable = loading ? availability[app.id] === true : true;
              return (
                <button
                  key={app.id}
                  className={`${menuItemBase} ${!isAvailable ? 'cursor-not-allowed opacity-50' : ''}`}
                  role="menuitem"
                  onClick={() => {
                    if (!isAvailable) return;
                    void persistPreferredApp(app.id);
                    setOpen(false);
                  }}
                  disabled={!isAvailable}
                >
                  {icons[app.id] ? (
                    <img
                      src={icons[app.id]}
                      alt={labels[app.id] || app.label}
                      className={`h-4 w-4 rounded ${app.invertInDark ? 'dark:invert' : ''}`}
                    />
                  ) : null}
                  <span>{labels[app.id] || app.label}</span>
                  {app.id === defaultApp && (
                    <span className="ml-auto text-xs text-muted-foreground">Selected</span>
                  )}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default OpenInMenu;
