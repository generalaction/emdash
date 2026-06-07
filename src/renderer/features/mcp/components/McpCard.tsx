import { ExternalLink, Globe, Pencil, Plus, Terminal } from 'lucide-react';
import React from 'react';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { CardGridItem } from '@renderer/lib/components/card-grid';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { agentConfig } from '@renderer/utils/agentConfig';
import { McpServerIcon } from '@renderer/utils/mcpIcons';
import { type AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import type { McpCatalogEntry, McpServer } from '@shared/core/mcp/types';

interface McpCardProps {
  server?: McpServer;
  catalogEntry?: McpCatalogEntry;
  onEdit: (server: McpServer) => void;
  onAdd?: (entry: McpCatalogEntry) => void;
}

function getTransport(server?: McpServer, entry?: McpCatalogEntry): 'stdio' | 'http' {
  if (server) return server.transport;
  const cfg = entry?.defaultConfig;
  if (cfg?.type === 'http' || (cfg && 'url' in cfg && !('command' in cfg))) return 'http';
  return 'stdio';
}

function getSyncedProviders(server?: McpServer) {
  if (!server) return [];
  return server.providers.flatMap((id) => {
    const cfg = agentConfig[id as AgentProviderId];
    return cfg ? [{ id, ...cfg }] : [];
  });
}

export const McpCard: React.FC<McpCardProps> = ({ server, catalogEntry, onEdit, onAdd }) => {
  const name = server?.name ?? catalogEntry?.name ?? 'Unknown';
  const description = catalogEntry?.description ?? (server ? `${server.transport} server` : '');
  const isInstalled = !!server;
  const transport = getTransport(server, catalogEntry);
  const docsUrl = catalogEntry?.docsUrl;
  const syncedProviders = getSyncedProviders(server);

  const handleClick = () => {
    if (isInstalled && server) {
      onEdit(server);
    } else if (catalogEntry && onAdd) {
      onAdd(catalogEntry);
    }
  };

  return (
    <CardGridItem
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      className="relative"
    >
      <McpServerIcon name={name} iconKey={catalogEntry?.key ?? server?.name} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <h3 className="text-smd truncate">{name}</h3>
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-background-2 px-1 py-0.5 text-[10px] text-foreground-muted">
            {transport === 'http' ? <Globe className="size-2" /> : <Terminal className="size-2" />}
            {transport}
          </span>
        </div>
        {description && <p className="line-clamp-1 text-xs text-foreground-muted">{description}</p>}
        {syncedProviders.length > 0 && (
          <div className="mt-1.5 flex items-center gap-1">
            {syncedProviders.map((p) => (
              <AgentLogo
                key={p.id}
                logo={p.logo}
                logoDark={p.logoDark}
                alt={p.alt}
                isSvg={p.isSvg}
                invertInDark={p.invertInDark}
                className="h-3.5 w-3.5 rounded-sm"
              />
            ))}
          </div>
        )}
      </div>

      <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {docsUrl && (
          <Tooltip>
            <TooltipTrigger>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(docsUrl, '_blank', 'noopener,noreferrer');
                }}
                aria-label={`View ${name} docs`}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>View docs</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                if (isInstalled && server) {
                  onEdit(server);
                } else if (catalogEntry && onAdd) {
                  onAdd(catalogEntry);
                }
              }}
              aria-label={isInstalled ? `Edit ${name}` : `Add ${name}`}
            >
              {isInstalled ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isInstalled ? 'Edit' : 'Add'}</TooltipContent>
        </Tooltip>
      </div>
    </CardGridItem>
  );
};
