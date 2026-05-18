import React from 'react';
import { SettingRow } from '@renderer/features/settings/components/SettingRow';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { Switch } from '@renderer/lib/ui/switch';
import { useMcpServerStatus } from './use-mcp-server-status';

function formatUptime(ms: number): string {
  if (!ms || ms < 1000) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (h > 0 || m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

export function McpServerStatusCard() {
  const { status, isLoading } = useMcpServerStatus();
  const [isPending, setIsPending] = React.useState(false);

  const enabled = status?.enabled ?? false;
  const running = status?.running ?? false;
  const port = status?.port ?? null;
  const uptime = status?.uptimeMs ?? 0;

  const handleToggle = async (next: boolean) => {
    setIsPending(true);
    try {
      const result = await rpc.mcpServer.setEnabled({ enabled: next });
      if (!result.success) {
        toast({
          title: 'Failed to update MCP server',
          description: result.error,
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Failed to update MCP server',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setIsPending(false);
    }
  };

  const indicatorClass = running
    ? 'bg-emerald-500'
    : enabled
      ? 'bg-amber-500'
      : 'bg-muted-foreground/50';

  const statusLabel = running
    ? `Running on 127.0.0.1:${port ?? '—'}`
    : enabled
      ? 'Starting…'
      : 'Stopped';

  return (
    <div className="flex flex-col gap-4">
      <SettingRow
        title="Enable MCP server"
        description="Expose emdash as a local MCP server so external agents (Claude Code, Cursor, Codex) can drive it."
        control={
          <Switch
            checked={enabled}
            disabled={isLoading || isPending}
            onCheckedChange={handleToggle}
            aria-label="Enable MCP server"
          />
        }
      />
      <SettingRow
        title="Status"
        description={
          <span className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${indicatorClass}`} />
            {statusLabel}
            {running && uptime > 0 && (
              <>
                <span className="text-foreground-passive">·</span>
                <span>Uptime {formatUptime(uptime)}</span>
              </>
            )}
          </span>
        }
        control={null}
      />
      {status?.lastError && (
        <p className="text-xs text-destructive">Last error: {status.lastError}</p>
      )}
    </div>
  );
}
