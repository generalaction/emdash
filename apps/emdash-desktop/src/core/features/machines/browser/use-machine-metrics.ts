import { useEffect, useState } from 'react';
import { appState } from '@renderer/lib/stores/app-state';
import { mockMachineMetrics, type MachineMetricsSample } from './machine-metrics';

const REFRESH_INTERVAL_MS = 5_000;

interface MetricsState {
  machineId: string;
  metrics: MachineMetricsSample;
}

export function useMachineMetrics(
  machineId: string | undefined,
  enabled: boolean
): MachineMetricsSample | null {
  const connected = machineId ? appState.machines.stateFor(machineId) === 'connected' : false;
  const [state, setState] = useState<MetricsState | null>(null);

  useEffect(() => {
    if (!enabled || !connected || !machineId) {
      setState(null);
      return;
    }

    const refresh = () => setState({ machineId, metrics: mockMachineMetrics(machineId) });
    refresh();
    const interval = window.setInterval(refresh, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [connected, enabled, machineId]);

  if (!enabled || !connected || !state || state.machineId !== machineId) return null;
  return state.metrics;
}
