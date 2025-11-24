import { useCallback, useEffect, useState } from 'react';
import { syncSessionRecordingFromMain } from '@/lib/sessionRecording';

type TelemetryState = {
  prefEnabled: boolean;
  envDisabled: boolean;
  hasKeyAndHost: boolean;
  sessionRecordingOptIn: boolean;
  loading: boolean;
};

const initialState: TelemetryState = {
  prefEnabled: true,
  envDisabled: false,
  hasKeyAndHost: true,
  sessionRecordingOptIn: false,
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
          sessionRecordingOptIn,
        } = res.status;
        setState({
          prefEnabled: !Boolean(envOff) && userOptOut !== true,
          envDisabled: Boolean(envOff),
          hasKeyAndHost: Boolean(hasKeyAndHost),
          sessionRecordingOptIn: Boolean(sessionRecordingOptIn),
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
      await syncSessionRecordingFromMain();
      await refresh();
    },
    [refresh]
  );

  const setSessionRecordingOptIn = useCallback(
    async (enabled: boolean) => {
      setState((prev) => ({ ...prev, sessionRecordingOptIn: enabled }));
      try {
        await window.electronAPI.setSessionRecordingOptIn(enabled);
      } catch {
        // ignore, refresh will reconcile
      }
      await syncSessionRecordingFromMain();
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
    setSessionRecordingOptIn,
  };
}
