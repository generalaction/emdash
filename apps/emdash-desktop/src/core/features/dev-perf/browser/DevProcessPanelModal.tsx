import { Button, Switch } from '@emdash/ui/react/primitives';
import React, { useEffect, useState } from 'react';
import { defineModal } from '@core/primitives/modals/react';
import { captureDevPerfTrace } from '../api/browser/capture-trace';
import { getDevPerfClient } from '../api/browser/client';
import type { DevPerfProcess } from '../api/contract';
import { createProcessPoller } from './process-poller';

function formatMemory(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

function totalOf(processes: DevPerfProcess[], pick: (p: DevPerfProcess) => number): number {
  return processes.reduce((sum, processInfo) => sum + pick(processInfo), 0);
}

type TraceState =
  | { kind: 'idle' }
  | { kind: 'recording' }
  | { kind: 'done'; path: string }
  | { kind: 'error'; message: string };

export function DevProcessPanelModal() {
  const [processes, setProcesses] = useState<DevPerfProcess[] | null>(null);
  const [supported, setSupported] = useState(true);
  const [spawnLogging, setSpawnLogging] = useState(false);
  const [trace, setTrace] = useState<TraceState>({ kind: 'idle' });

  // Poll only while the panel is mounted; unmount stops all polling.
  useEffect(() => {
    const poller = createProcessPoller({
      fetchSnapshot: async () => (await getDevPerfClient()).processSnapshot(),
      onSnapshot(snapshot) {
        setSupported(snapshot.supported);
        setProcesses(snapshot.processes);
      },
    });
    return () => poller.stop();
  }, []);

  useEffect(() => {
    void getDevPerfClient().then(async (client) => {
      const { enabled } = await client.getVerboseSpawnLogging();
      setSpawnLogging(enabled);
    });
  }, []);

  const handleCaptureTrace = async () => {
    setTrace({ kind: 'recording' });
    const outcome = await captureDevPerfTrace();
    setTrace(
      outcome.ok
        ? { kind: 'done', path: outcome.path }
        : { kind: 'error', message: outcome.message }
    );
  };

  const handleSpawnLoggingChange = async (enabled: boolean) => {
    setSpawnLogging(enabled);
    const client = await getDevPerfClient();
    await client.setVerboseSpawnLogging({ enabled });
  };

  return (
    <div className="flex min-h-0 flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold">Process Panel</h2>

      <div className="flex items-center gap-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleCaptureTrace()}
          disabled={trace.kind === 'recording'}
        >
          {trace.kind === 'recording' ? 'Recording trace (10 s)…' : 'Capture trace (10 s)'}
        </Button>
        <label className="flex items-center gap-2 text-xs">
          <Switch
            checked={spawnLogging}
            onCheckedChange={(checked) => void handleSpawnLoggingChange(checked)}
          />
          Verbose spawn logging
        </label>
      </div>

      {trace.kind === 'done' && (
        <p className="text-muted-foreground font-mono text-[11px] break-all select-text">
          Trace written to {trace.path}
        </p>
      )}
      {trace.kind === 'error' && (
        <p className="text-destructive text-xs">Trace capture failed: {trace.message}</p>
      )}

      {!supported && (
        <p className="text-muted-foreground text-xs">
          Process snapshots are not supported on this platform.
        </p>
      )}

      {processes === null ? (
        <p className="text-muted-foreground text-xs">Loading…</p>
      ) : (
        <div className="max-h-[55dvh] overflow-y-auto rounded border">
          <table className="w-full text-left font-mono text-xs">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="px-2 py-1 font-medium">Process</th>
                <th className="w-16 px-2 py-1 text-right font-medium">PID</th>
                <th className="w-16 px-2 py-1 text-right font-medium">CPU %</th>
                <th className="w-24 px-2 py-1 text-right font-medium">Memory</th>
              </tr>
            </thead>
            <tbody>
              {processes.map((processInfo) => (
                <tr key={processInfo.pid} className="border-t">
                  <td
                    className="max-w-0 truncate px-2 py-0.5"
                    style={{ paddingLeft: `${8 + processInfo.depth * 16}px` }}
                    title={processInfo.command}
                  >
                    {processInfo.command}
                  </td>
                  <td className="px-2 py-0.5 text-right">{processInfo.pid}</td>
                  <td className="px-2 py-0.5 text-right">{processInfo.cpuPercent.toFixed(1)}</td>
                  <td className="px-2 py-0.5 text-right">{formatMemory(processInfo.rssBytes)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-muted/50 border-t">
                <td className="px-2 py-1 font-medium">Total ({processes.length} processes)</td>
                <td />
                <td className="px-2 py-1 text-right font-medium">
                  {totalOf(processes, ({ cpuPercent }) => cpuPercent).toFixed(1)}
                </td>
                <td className="px-2 py-1 text-right font-medium">
                  {formatMemory(totalOf(processes, ({ rssBytes }) => rssBytes))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

export const devProcessPanelModal = defineModal<void>()({
  id: 'devProcessPanelModal',
  component: DevProcessPanelModal,
  size: 'lg',
});
