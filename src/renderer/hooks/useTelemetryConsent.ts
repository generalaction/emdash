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

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const res = await rpc.telemetry.getStatus();
      if (res?.status) {
        const { envDisabled: envOff, userOptOut, hasKeyAndHost } = res.status;
        setState({
          prefEnabled: !Boolean(envOff) && userOptOut !== true,
          envDisabled: Boolean(envOff),
          hasKeyAndHost: Boolean(hasKeyAndHost),
          loading: false,
        });
        return;
      }
    } catch {
      // ignore and fall through to loading reset
    }
    setState((prev) => ({ ...prev, loading: false }));
  }, []);

  const setTelemetryEnabled = useCallback(
    async (enabled: boolean) => {
      setState((prev) => ({ ...prev, prefEnabled: enabled }));
      try {
        await rpc.telemetry.setEnabled(enabled);
      } catch {
        // ignore, refresh will reconcile
      }
      await refresh();
    },
    [refresh]
  );

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    ...state,
    refresh,
    setTelemetryEnabled,
  };
}
