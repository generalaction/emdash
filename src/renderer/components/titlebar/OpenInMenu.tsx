import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import { Button } from '../ui/button';
import { useToast } from '@/hooks/use-toast';
import { getAppById, OPEN_IN_APPS, type OpenInAppId } from '@shared/openInApps';

interface OpenInMenuProps {
  path: string;
  align?: 'left' | 'right';
}

const menuItemBase =
  'flex w-full select-none items-center gap-2 rounded px-2.5 py-2 text-sm transition-colors';

const getMenuItemClasses = (isAvailable: boolean) => {
  if (!isAvailable) {
    return `${menuItemBase} cursor-not-allowed opacity-40`;
  }
  return `${menuItemBase} cursor-pointer hover:bg-accent hover:text-accent-foreground`;
};

const OpenInMenu: React.FC<OpenInMenuProps> = ({ path, align = 'right' }) => {
  const [open, setOpen] = React.useState(false);
  const [availability, setAvailability] = React.useState<Record<string, boolean>>({});
  const [icons, setIcons] = React.useState<Partial<Record<OpenInAppId, string>>>({});
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const shouldReduceMotion = useReducedMotion();
  const { toast } = useToast();

  // Fetch app availability on mount
  React.useEffect(() => {
    const fetchAvailability = async () => {
      try {
        const apps = await (window as any).electronAPI?.checkInstalledApps?.();
        if (apps) setAvailability(apps);
      } catch (e) {
        console.error('Failed to check installed apps:', e);
      }
    };
    void fetchAvailability();
  }, []);

  // Dynamically load icons
  React.useEffect(() => {
    const loadIcons = async () => {
      const loadedIcons: Partial<Record<OpenInAppId, string>> = {};

      for (const app of OPEN_IN_APPS) {
        try {
          loadedIcons[app.id] = new URL(
            `../../../assets/images/${app.iconPath}`,
            import.meta.url
          ).href;
        } catch (e) {
          console.error(`Failed to load icon for ${app.id}:`, e);
        }
      }

      setIcons(loadedIcons);
    };
    void loadIcons();
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
    // Check if app is available
    // noinspection PointlessBooleanExpressionJS
    if (availability[appId] === false) {
      return; // Don't proceed if app is not installed
    }

    const appConfig = getAppById(appId);
    const label = appConfig?.label || appId;

    void import('../../lib/telemetryClient').then(({ captureTelemetry }) => {
      captureTelemetry('toolbar_open_in_selected', { app: appId });
    });
    try {
      const res = await (window as any).electronAPI?.openIn?.({ app: appId, path });
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
            {OPEN_IN_APPS.map((app) => (
              <button
                key={app.id}
                className={getMenuItemClasses(availability[app.id])}
                role="menuitem"
                onClick={() => callOpen(app.id)}
                disabled={!availability[app.id]}
                title={!availability[app.id] ? 'Not installed' : undefined}
              >
                {icons[app.id] ? (
                  <img
                    src={icons[app.id]}
                    alt={app.label}
                    className="h-4 w-4 rounded"
                  />
                ) : null}
                <span>{app.label}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default OpenInMenu;
