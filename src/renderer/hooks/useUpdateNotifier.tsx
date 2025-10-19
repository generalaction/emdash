import { useEffect } from 'react';
import { useToast } from './use-toast';
import { ToastAction } from '@/components/ui/toast';

type Options = {
  checkOnMount?: boolean;
  onOpenSettings?: () => void;
  snoozeHours?: number; // suppress repeat toasts for same version within this window
};

const LAST_NOTIFIED_KEY = 'emdash:update:lastNotified'; // JSON: { version: string, at: number }

export function useUpdateNotifier(opts: Options = {}) {
  const { checkOnMount = true, onOpenSettings, snoozeHours = 6 } = opts;
  const { toast } = useToast();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const shouldNotify = (availableVersion?: string) => {
      try {
        const raw = localStorage.getItem(LAST_NOTIFIED_KEY);
        if (!raw) return true;
        const parsed = JSON.parse(raw || '{}') as { version?: string; at?: number };
        if (availableVersion && parsed.version && parsed.version === availableVersion) {
          const at = parsed.at || 0;
          if (Date.now() - at < Math.max(1, snoozeHours) * 3600_000) return false;
        }
        return true;
      } catch {
        return true;
      }
    };

    const rememberNotified = (version?: string) => {
      try {
        localStorage.setItem(
          LAST_NOTIFIED_KEY,
          JSON.stringify({ version: version || 'unknown', at: Date.now() })
        );
      } catch {}
    };

    const off = window.electronAPI.onUpdateEvent?.((evt) => {
      if (evt?.type === 'available') {
        const v = evt?.payload?.version || evt?.payload?.tag || undefined;
        if (!shouldNotify(v)) return;
        try {
          toast({
            title: 'Update available',
            description: 'There is a new update available. Go to Settings to download the new DMG.',
            action: (
              <ToastAction altText="Open Settings" onClick={() => onOpenSettings?.()}>
                Open Settings
              </ToastAction>
            ),
          });
          rememberNotified(v);
        } catch {}
      }
    });

    if (checkOnMount) {
      (async () => {
        try {
          await window.electronAPI.checkForUpdates?.();
        } catch {}
      })();
    }

    return () => {
      try {
        off?.();
      } catch {}
    };
  }, [checkOnMount, onOpenSettings, snoozeHours, toast]);
}

export default useUpdateNotifier;
