import type { McpServer } from '@emdash/core/primitives/mcp/api';
import { ExternalLink, Globe, Loader2, Terminal, X } from 'lucide-react';
import React from 'react';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Button } from '@renderer/lib/ui/button';
import { Field } from '@renderer/lib/ui/field';
import { Label } from '@renderer/lib/ui/label';
import { useAgentMcps } from './useAgentMcps';

function McpServerPill({
  server,
  isRemoving,
  onRemove,
}: {
  server: McpServer;
  isRemoving: boolean;
  onRemove: () => void;
}) {
  const Icon = server.transport === 'http' ? Globe : Terminal;

  return (
    <span
      className="group hover:border-destructive/60 inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-border bg-background-quaternary-1 pr-1.5 pl-3 text-xs text-foreground transition-colors hover:bg-background-destructive hover:text-foreground-destructive"
      title={`${server.name} (${server.transport})`}
    >
      <Icon
        className="size-3.5 shrink-0 text-foreground-muted transition-opacity group-hover:opacity-35"
        aria-hidden="true"
      />
      <span className="min-w-0 truncate font-medium transition-opacity group-hover:opacity-35">
        {server.name}
      </span>
      <span className="shrink-0 text-foreground-muted transition-opacity group-hover:opacity-35">
        {server.transport}
      </span>
      <button
        type="button"
        disabled={isRemoving}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-foreground-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground-destructive disabled:opacity-60"
        onClick={onRemove}
        aria-label={`Remove ${server.name} from this agent`}
      >
        {isRemoving ? (
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        ) : (
          <X className="size-3" aria-hidden="true" />
        )}
      </button>
    </span>
  );
}

function EmptyMcpState() {
  return (
    <p className="text-muted-foreground text-xs">No MCP servers configured for this agent yet.</p>
  );
}

export function AgentMcpSection({ agentId }: { agentId: string }) {
  const { servers, isLoading, removeServer, removingServerName } = useAgentMcps(agentId);
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
      <div>
        {isLoading ? (
          <div className="flex h-9 items-center justify-center">
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          </div>
        ) : servers.length === 0 ? (
          <EmptyMcpState />
        ) : (
          <div className="flex flex-wrap gap-2">
            {servers.map((server) => (
              <McpServerPill
                key={server.name}
                server={server}
                isRemoving={removingServerName === server.name}
                onRemove={() => removeServer(server.name)}
              />
            ))}
          </div>
        )}
      </div>
    </Field>
  );
}
