import React, { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Switch } from './ui/switch';
import { Input } from './ui/input';
import { useAppSettings } from '@/contexts/AppSettingsProvider';

const DEFAULT_PORT = 17823;
const DOCS_URL = 'https://emdash.ai/docs/mcp';

const McpSettingsCard: React.FC = () => {
  const { settings, updateSettings, isLoading: loading } = useAppSettings();
  const [serverInfo, setServerInfo] = useState<{
    running: boolean;
    port?: number;
    mcpUrl?: string;
  }>({
    running: false,
  });
  const [portInput, setPortInput] = useState('');

  const enabled = settings?.mcp?.enabled ?? false;
  const configuredPort = settings?.mcp?.port;

  useEffect(() => {
    setPortInput(String(configuredPort ?? DEFAULT_PORT));
  }, [configuredPort]);

  useEffect(() => {
    if (!enabled) {
      setServerInfo({ running: false });
      return;
    }
    // Short delay so a port-change restart has time to complete before we query.
    const timer = setTimeout(() => {
      window.electronAPI.mcpGetServerInfo().then((info) => {
        setServerInfo(
          info.running
            ? { running: true, port: info.port, mcpUrl: info.mcpUrl }
            : { running: false }
        );
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [enabled, configuredPort]);

  const handlePortBlur = () => {
    const parsed = parseInt(portInput, 10);
    if (
      !isNaN(parsed) &&
      parsed >= 1024 &&
      parsed <= 65535 &&
      parsed !== (configuredPort ?? DEFAULT_PORT)
    ) {
      updateSettings({ mcp: { port: parsed } });
    } else {
      setPortInput(String(configuredPort ?? DEFAULT_PORT));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-1 flex-col gap-0.5">
          <p className="text-sm font-medium text-foreground">MCP Server</p>
          <p className="text-sm text-muted-foreground">
            Expose an MCP endpoint so AI agents (e.g. Claude Code) can create tasks in Emdash.{' '}
            <button
              type="button"
              className="inline-flex items-center gap-0.5 text-foreground underline-offset-2 hover:underline"
              onClick={() => window.open(DOCS_URL, '_blank', 'noopener,noreferrer')}
            >
              Learn more
              <ExternalLink className="h-3 w-3" />
            </button>
          </p>
        </div>
        <Switch
          checked={enabled}
          disabled={loading}
          onCheckedChange={(next) => updateSettings({ mcp: { enabled: next } })}
        />
      </div>

      {enabled && (
        <div className="flex flex-col gap-3 rounded-md border bg-muted/50 px-3 py-3">
          <div className="flex items-center gap-3">
            <div className="flex flex-1 flex-col gap-0.5">
              <p className="text-xs font-medium text-foreground">Port</p>
              <p className="text-xs text-muted-foreground">
                Preferred port (1024–65535). Falls back to the next available if taken.
              </p>
            </div>
            <Input
              className="w-24 text-right font-mono text-sm"
              value={portInput}
              disabled={loading}
              onChange={(e) => setPortInput(e.target.value)}
              onBlur={handlePortBlur}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </div>

          {serverInfo.running && serverInfo.mcpUrl && (
            <div className="flex flex-col gap-0.5">
              <p className="text-xs font-medium text-foreground">MCP URL</p>
              <p className="break-all font-mono text-xs text-muted-foreground">
                {serverInfo.mcpUrl}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default McpSettingsCard;
