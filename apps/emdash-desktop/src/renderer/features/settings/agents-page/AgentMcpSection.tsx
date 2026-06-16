import { ExternalLink, Globe, Loader2, Terminal } from 'lucide-react';
import React from 'react';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Button } from '@renderer/lib/ui/button';
import { Field } from '@renderer/lib/ui/field';
import { Label } from '@renderer/lib/ui/label';
import type { McpServer } from '@shared/core/mcp/types';
import { useAgentMcps } from './useAgentMcps';

function TransportBadge({ transport }: { transport: 'stdio' | 'http' }) {
  return (
    <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs">
      {transport === 'http' ? (
        <Globe className="size-3" aria-hidden="true" />
      ) : (
        <Terminal className="size-3" aria-hidden="true" />
      )}
      {transport}
    </span>
  );
}

function McpServerRow({ server }: { server: McpServer }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
      <span className="truncate text-sm font-medium">{server.name}</span>
      <TransportBadge transport={server.transport} />
    </div>
  );
}

function EmptyMcpState() {
  return (
    <p className="text-muted-foreground text-xs">No MCP servers configured for this agent yet.</p>
  );
}

export function AgentMcpSection({ agentId }: { agentId: string }) {
  const { servers, isLoading } = useAgentMcps(agentId);
  const { navigate } = useNavigate();

  return (
    <Field>
      <div className="flex items-center justify-between">
        <Label>MCP Servers</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-xs"
          onClick={() => navigate('library', { tab: 'mcp' })}
        >
          <ExternalLink className="size-3" aria-hidden="true" />
          Manage in Library
        </Button>
      </div>
      <div className="space-y-1.5">
        {isLoading ? (
          <div className="flex h-9 items-center justify-center">
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          </div>
        ) : servers.length === 0 ? (
          <EmptyMcpState />
        ) : (
          servers.map((s) => <McpServerRow key={s.name} server={s} />)
        )}
      </div>
    </Field>
  );
}
