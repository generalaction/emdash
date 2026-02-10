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
}

const menuItemBase =
  'flex w-full select-none items-center gap-2 rounded px-2.5 py-2 text-sm transition-colors cursor-pointer hover:bg-accent hover:text-accent-foreground';

const OpenInMenu: React.FC<OpenInMenuProps> = ({
  path,
  align = 'right',
  isRemote = false,
  sshConnectionId = null,
}) => {
  const [open, setOpen] = React.useState(false);
  const [defaultApp, setDefaultApp] = React.useState<OpenInAppId | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const shouldReduceMotion = useReducedMotion();
  const { toast } = useToast();
  const { icons, installedApps, availability, loading } = useOpenInApps();

  // Fetch default app setting on mount and listen for changes
  React.useEffect(() => {
    const fetchDefaultApp = async () => {
      try {
        const res = await window.electronAPI?.getSettings?.();
        if (res?.success && res.settings?.defaultOpenInApp) {
          const app = res.settings.defaultOpenInApp;
          if (isValidOpenInAppId(app)) {
            setDefaultApp(app);
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

  const callOpen = async (appId: OpenInAppId) => {
    const appConfig = getAppById(appId);
    const label = appConfig?.label || appId;

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
  };

  // Sort installed apps with default first
  const sortedApps = React.useMemo(() => {
    if (!defaultApp) return installedApps;
    return [...installedApps].sort((a, b) => {
      if (a.id === defaultApp) return -1;
      if (b.id === defaultApp) return 1;
      return 0;
    });
  }, [defaultApp, installedApps]);

  // Determine which icon to show on the button (default if installed, otherwise first installed)
  const buttonAppId = React.useMemo(() => {
    if (defaultApp && installedApps.some((app) => app.id === defaultApp)) {
      return defaultApp;
    }
    return installedApps[0]?.id;
  }, [defaultApp, installedApps]);

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={[
          'h-7 gap-1.5 px-2 text-[13px] font-medium leading-none text-muted-foreground hover:bg-background/70 hover:text-foreground',
          open ? 'bg-background/80 text-foreground' : '',
        ].join(' ')}
        onClick={async () => {
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
      >
        <span>Open in</span>
        {buttonAppId && icons[buttonAppId] && (
          <img
            src={icons[buttonAppId]}
            alt={getAppById(buttonAppId)?.label}
            className="h-4 w-4 rounded"
          />
        )}
        <ChevronDown
          className={`h-3 w-3 opacity-50 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </Button>
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
            {sortedApps.map((app) => {
              // While loading, disable apps that aren't confirmed installed
              const isAvailable = loading ? availability[app.id] === true : true;
              return (
                <button
                  key={app.id}
                  className={`${menuItemBase} ${!isAvailable ? 'cursor-not-allowed opacity-50' : ''}`}
                  role="menuitem"
                  onClick={() => isAvailable && callOpen(app.id)}
                  disabled={!isAvailable}
                >
                  {icons[app.id] ? (
                    <img src={icons[app.id]} alt={app.label} className="h-4 w-4 rounded" />
                  ) : null}
                  <span>{app.label}</span>
                  {app.id === defaultApp && (
                    <span className="ml-auto text-xs text-muted-foreground">Default</span>
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
