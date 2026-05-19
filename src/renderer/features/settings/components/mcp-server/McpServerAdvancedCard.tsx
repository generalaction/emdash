import { FolderOpen } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { SettingRow } from '../SettingRow';

function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

export function McpServerAdvancedCard() {
  const { value: mcpServer, isLoading, isSaving } = useAppSettingsKey('mcpServer');

  const persistedPort = mcpServer?.port ?? null;
  const [draftPort, setDraftPort] = useState<string>(persistedPort?.toString() ?? '');
  const [isPersisting, setIsPersisting] = useState(false);

  // Keep the draft input in sync when the underlying value changes (e.g. from
  // another renderer instance or after `setPort` resolves).
  useEffect(() => {
    if (persistedPort !== null) {
      setDraftPort(persistedPort.toString());
    }
  }, [persistedPort]);

  const parsed = Number.parseInt(draftPort, 10);
  const isValid = Number.isFinite(parsed) && isValidPort(parsed);
  const isDirty = persistedPort !== null && parsed !== persistedPort;
  const busy = isLoading || isSaving || isPersisting;

  const handleSavePort = useCallback(async () => {
    if (!isValid || !isDirty) return;
    setIsPersisting(true);
    try {
      const result = await rpc.mcpServer.setPort({ port: parsed });
      if (!result.success) {
        toast({
          title: 'Failed to update MCP server port',
          description: result.error,
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Failed to update MCP server port',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setIsPersisting(false);
    }
  }, [isDirty, isValid, parsed]);

  const handleRevealTokenFile = useCallback(async () => {
    try {
      const result = await rpc.mcpServer.revealTokenFile();
      if (!result.success) {
        toast({
          title: 'Failed to locate mcp.json',
          description: result.error,
          variant: 'destructive',
        });
        return;
      }
      const openResult = await rpc.app.openIn({ app: 'finder', path: result.data.path });
      if (!openResult.success) {
        toast({
          title: 'Failed to open mcp.json',
          description: openResult.error,
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Failed to open mcp.json',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <SettingRow
        title="Loopback port"
        description="The MCP HTTP server binds to 127.0.0.1 on this port. Valid range: 1–65535."
        control={
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={65535}
              value={draftPort}
              onChange={(e) => setDraftPort(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && isValid && isDirty) {
                  e.preventDefault();
                  void handleSavePort();
                }
              }}
              disabled={busy}
              aria-label="MCP server port"
              aria-invalid={!isValid}
              className="h-8 w-24 text-right tabular-nums"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleSavePort()}
              disabled={busy || !isValid || !isDirty}
            >
              Save
            </Button>
          </div>
        }
      />
      <SettingRow
        title="Token file"
        description="Open ~/.emdash/mcp.json in Finder. The file is created on first start and holds the bearer token used by external MCP clients."
        control={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleRevealTokenFile()}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Open in Finder
          </Button>
        }
      />
    </div>
  );
}
