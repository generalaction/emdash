import { useEffect, useState } from 'react';
import type { EmdashServerConnection } from '@main/core/settings/schema';
import { rpc } from '@renderer/lib/ipc';

export type ServerStatus = 'checking' | 'online' | 'auth_error' | 'offline';

export function useServerStatus(server: EmdashServerConnection): ServerStatus {
  const [status, setStatus] = useState<ServerStatus>('checking');

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const result = await rpc.automations.checkServerHealth(server.url, server.apiKey);
        if (cancelled) return;
        if (result.success) setStatus(result.data);
        else setStatus('offline');
      } catch {
        if (!cancelled) setStatus('offline');
      }
    }

    void check();
    const interval = setInterval(() => void check(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [server.url, server.apiKey]);

  return status;
}
