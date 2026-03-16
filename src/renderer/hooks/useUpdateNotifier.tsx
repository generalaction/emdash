import { useEffect } from 'react';
import { rpc } from '../core/ipc';
import { useToast } from './use-toast';

type Options = {
  checkOnMount?: boolean;
  onOpenSettings?: () => void;
  snoozeHours?: number;
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

    const off = window.electronAPI?.onUpdateEvent?.((evt) => {
      if (evt?.type === 'available') {
        const v = evt?.payload?.version || evt?.payload?.tag || undefined;
        if (!shouldNotify(v)) return;
        try {
          toast({
            title: 'Update Available',
            description: `Version ${v || 'new'} is ready. Open Settings to review and download when convenient.`,
            action: { label: 'Open Settings', onClick: () => onOpenSettings?.() },
          });
          rememberNotified(v);
        } catch {}
      }
    });

    if (checkOnMount) {
      (async () => {
        try {
          await rpc.update.check();
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
