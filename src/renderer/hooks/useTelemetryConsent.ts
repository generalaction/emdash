import { useCallback, useEffect, useState } from 'react';
import { rpc } from '../core/ipc';

type TelemetryState = {
  prefEnabled: boolean;
  envDisabled: boolean;
  hasKeyAndHost: boolean;
  loading: boolean;
};

const initialState: TelemetryState = {
  prefEnabled: true,
  envDisabled: false,
  hasKeyAndHost: true,
  loading: true,
};

export function useTelemetryConsent() {
  const [state, setState] = useState<TelemetryState>(initialState);

  const applyStatus = useCallback(
    (res: Awaited<ReturnType<typeof rpc.telemetry.getStatus>> | null) => {
      if (res?.status) {
        const { envDisabled: envOff, userOptOut, hasKeyAndHost } = res.status;
        setState({
          prefEnabled: !envOff && userOptOut !== true,
          envDisabled: !!envOff,
          hasKeyAndHost: !!hasKeyAndHost,
          loading: false,
        });
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
