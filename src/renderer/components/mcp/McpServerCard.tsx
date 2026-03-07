import React from 'react';
import { motion } from 'framer-motion';
import { Plus, Pencil, Server } from 'lucide-react';
import type { McpServer, McpCatalogEntry } from '@shared/mcp/types';

interface McpServerCardProps {
  server?: McpServer;
  catalogEntry?: McpCatalogEntry;
  onEdit: (server: McpServer) => void;
  onAdd?: (entry: McpCatalogEntry) => void;
}

export const McpServerCard: React.FC<McpServerCardProps> = ({
  server,
  catalogEntry,
  onEdit,
  onAdd,
}) => {
  const name = server?.name ?? catalogEntry?.name ?? 'Unknown';
  const description = catalogEntry?.description ?? (server ? `${server.transport} server` : '');
  const isInstalled = !!server;

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
      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-muted/40">
        <Server className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold">{name}</h3>
        {description && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{description}</p>
        )}
        {server && server.providers.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground/70">{server.providers.join(', ')}</p>
        )}
      </div>
      <div className="flex-shrink-0 self-center">
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
