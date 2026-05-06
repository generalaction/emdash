import { useCallback, useEffect, useState } from 'react';
import { rpc } from '@renderer/lib/ipc';

type TelemetryState = {
  prefEnabled: boolean;
  envDisabled: boolean;
  hasKeyAndHost: boolean;
  loading: boolean;
};

const CACHE_KEY = 'emdash:telemetry-consent-cache';

const readCache = (): TelemetryState | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TelemetryState>;
    if (typeof parsed.prefEnabled !== 'boolean') return null;
    return {
      prefEnabled: parsed.prefEnabled,
      envDisabled: !!parsed.envDisabled,
      hasKeyAndHost: parsed.hasKeyAndHost !== false,
      loading: true,
    };
  } catch {
    return null;
  }
};

const writeCache = (state: TelemetryState) => {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        prefEnabled: state.prefEnabled,
        envDisabled: state.envDisabled,
        hasKeyAndHost: state.hasKeyAndHost,
      })
    );
  } catch {
    // ignore
  }
};

const fallbackInitialState: TelemetryState = {
  prefEnabled: true,
  envDisabled: false,
  hasKeyAndHost: true,
  loading: true,
};

export function useTelemetryConsent() {
  const [state, setState] = useState<TelemetryState>(() => readCache() ?? fallbackInitialState);

  const applyStatus = useCallback(
    (res: Awaited<ReturnType<typeof rpc.telemetry.getStatus>> | null) => {
      if (res?.status) {
        const { envDisabled: envOff, userOptOut, hasKeyAndHost } = res.status;
        const next: TelemetryState = {
          prefEnabled: !envOff && userOptOut !== true,
          envDisabled: !!envOff,
          hasKeyAndHost: !!hasKeyAndHost,
          loading: false,
        };
        writeCache(next);
        setState(next);
      } else {
        setState((prev) => ({ ...prev, loading: false }));
      }
    },
    []
  );

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }));
    try {
      applyStatus(await rpc.telemetry.getStatus());
    } catch {
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, [applyStatus]);

  const setTelemetryEnabled = useCallback(
    async (enabled: boolean) => {
      setState((prev) => ({ ...prev, prefEnabled: enabled, loading: true }));
      try {
        await rpc.telemetry.setEnabled(enabled);
      } catch {
        // ignore, refresh will reconcile
      }
      await refresh();
    },
    [refresh]
  );

  useEffect(() => {
    let cancelled = false;
    rpc.telemetry
      .getStatus()
      .then((res) => {
        if (!cancelled) applyStatus(res);
      })
      .catch(() => {
        if (!cancelled) setState((prev) => ({ ...prev, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [applyStatus]);

  return {
    ...state,
    refresh,
    setTelemetryEnabled,
  };
}
