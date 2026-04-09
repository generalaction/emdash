import { motion } from 'framer-motion';
import { ExternalLink, Globe, Pencil, Plus, Terminal } from 'lucide-react';
import React from 'react';
import { AgentProviderId } from '@shared/agent-provider-registry';
import type { McpCatalogEntry, McpServer } from '@shared/mcp/types';
import { agentConfig } from '../../lib/agentConfig';
import { McpServerIcon } from '../../lib/mcpIcons';
import AgentLogo from '../agent-logo';

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
    <motion.div
      role="button"
      tabIndex={0}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.1, ease: 'easeInOut' }}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      className="group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-muted/20 p-4 text-left text-card-foreground shadow-sm transition-all hover:bg-muted/40 hover:shadow-md"
    >
      <McpServerIcon name={name} iconKey={catalogEntry?.key ?? server?.name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h3 className="truncate text-sm font-semibold">{name}</h3>
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
            {transport === 'http' ? (
              <Globe className="h-2.5 w-2.5" />
            ) : (
              <Terminal className="h-2.5 w-2.5" />
            )}
            {transport}
          </span>
        </div>
        {description && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{description}</p>
        )}
        {syncedProviders.length > 0 && (
          <div className="mt-1.5 flex items-center gap-1">
            {syncedProviders.map((p) => (
              <AgentLogo
                key={p.id}
                logo={p.logo}
                alt={p.alt}
                isSvg={p.isSvg}
                invertInDark={p.invertInDark}
                className="h-3.5 w-3.5 rounded-sm"
              />
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 self-center">
        {docsUrl && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              window.open(docsUrl, '_blank', 'noopener,noreferrer');
            }}
            className="rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100"
            aria-label={`View ${name} docs`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        )}
        {isInstalled ? (
          <Pencil className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        ) : onAdd ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (catalogEntry) onAdd(catalogEntry);
            }}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={`Add ${name}`}
          >
            <Plus className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </motion.div>
  );
};
