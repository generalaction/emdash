import { useCallback, useEffect, useState } from 'react';

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
      const res = await window.electronAPI.getTelemetryStatus?.();
      if (res?.success && res.status) {
        const {
          envDisabled: envOff,
          userOptOut,
          hasKeyAndHost,
        } = res.status;
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
        await window.electronAPI.setTelemetryEnabled(enabled);
      } catch {
        // ignore, refresh will reconcile
      }
      await refresh();
    },
    [refresh]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    ...state,
    refresh,
    setTelemetryEnabled,
  };
}
