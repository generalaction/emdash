import { CircleDashed } from 'lucide-react';
import React from 'react';
import { Badge } from '@renderer/lib/ui/badge';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { useMcpRecentCalls } from './use-mcp-recent-calls';

/**
 * Shows the most recent 20 MCP tool invocations. Hydrates from
 * `mcpServer.getRecentCalls` and live-updates via
 * `mcpServerRecentCallChannel` (handled inside `useMcpRecentCalls`).
 */
export function McpServerRecentCallsCard() {
  const { calls, isLoading } = useMcpRecentCalls(20);

  if (isLoading && calls.length === 0) {
    return <p className="text-xs text-foreground-passive">Loading recent calls…</p>;
  }

  if (calls.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 bg-muted/10 p-8 text-center">
        <CircleDashed className="h-5 w-5 text-foreground-passive" />
        <div className="flex flex-col gap-0.5">
          <p className="text-sm text-foreground">No recent MCP calls</p>
          <p className="text-xs text-foreground-passive">
            Tool invocations from external MCP clients will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      <table className="w-full table-fixed text-sm">
        <thead className="bg-muted/20 text-xs text-foreground-muted">
          <tr>
            <th className="px-3 py-2 text-left font-normal">Tool</th>
            <th className="w-20 px-3 py-2 text-left font-normal">Status</th>
            <th className="w-20 px-3 py-2 text-right font-normal">Duration</th>
            <th className="w-24 px-3 py-2 text-right font-normal">When</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((call) => (
            <tr
              key={call.id}
              className="border-t border-border/40 transition-colors hover:bg-muted/20"
            >
              <td className="truncate px-3 py-2 font-mono text-xs text-foreground">
                <span title={call.tool}>{call.tool}</span>
                {call.status === 'error' && call.errorMessage && (
                  <span
                    className="ml-2 text-[10px] text-foreground-passive"
                    title={call.errorMessage}
                  >
                    {call.errorCode ?? 'error'}
                  </span>
                )}
              </td>
              <td className="px-3 py-2">
                <Badge variant={call.status === 'ok' ? 'secondary' : 'destructive'}>
                  {call.status === 'ok' ? 'OK' : 'Error'}
                </Badge>
              </td>
              <td className="px-3 py-2 text-right text-xs tabular-nums text-foreground-muted">
                {Math.round(call.ms)}ms
              </td>
              <td className="px-3 py-2 text-right text-xs text-foreground-muted">
                <RelativeTime value={call.ts} compact ago />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
