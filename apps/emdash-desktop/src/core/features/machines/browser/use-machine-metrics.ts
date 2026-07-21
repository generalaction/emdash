import type { ResourceUsageSample } from '@emdash/core/runtimes/resource-usage/api';
import { useEffect, useState } from 'react';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { appState } from '@renderer/lib/stores/app-state';

const REFRESH_INTERVAL_MS = 5_000;

interface MetricsState {
  machineId: string;
  metrics: ResourceUsageSample;
}

export function useMachineMetrics(
  machineId: string | undefined,
  enabled: boolean
): ResourceUsageSample | null {
  const connected = machineId ? appState.machines.stateFor(machineId) === 'connected' : false;
  const [state, setState] = useState<MetricsState | null>(null);

  useEffect(() => {
    if (!enabled || !connected || !machineId) {
      setState(null);
      return;
    }

    let cancelled = false;
    const refresh = async () => {
      try {
        const client = await getDesktopWireClient();
        const metrics = await client.machines.getMachineMetrics({ machineId });
        if (!cancelled) setState({ machineId, metrics });
      } catch {
        if (!cancelled) setState(null);
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [connected, enabled, machineId]);

  if (!enabled || !connected || !state || state.machineId !== machineId) return null;
  return state.metrics;
}
