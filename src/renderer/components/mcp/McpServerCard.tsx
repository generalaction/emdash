import React from 'react';
import { motion } from 'framer-motion';
import { Plus, Pencil, ExternalLink, Globe, Terminal } from 'lucide-react';
import type { McpServer, McpCatalogEntry } from '@shared/mcp/types';
import AgentLogo from '../AgentLogo';
import { agentConfig } from '../../lib/agentConfig';
import { mcpIconMap } from '../../lib/mcpIcons';
import { useTheme } from '../../hooks/useTheme';
import type { Agent } from '../../types';

interface McpServerCardProps {
  server?: McpServer;
  catalogEntry?: McpCatalogEntry;
  onEdit: (server: McpServer) => void;
  onAdd?: (entry: McpCatalogEntry) => void;
}

const McpIcon: React.FC<{ name: string; catalogKey?: string }> = ({ name, catalogKey }) => {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme !== 'light';
  const iconDef = catalogKey ? mcpIconMap[catalogKey] : undefined;

  if (iconDef && iconDef.type === 'svg' && iconDef.data) {
    let processed = iconDef.data;
    if (iconDef.preserveColors) {
      // Multi-color logos: keep original colors, only strip dimensions
      processed = processed.replace(/\bwidth="[^"]*"/g, '').replace(/\bheight="[^"]*"/g, '');
    } else {
      // Monochrome SVGs (Simple Icons): set fill color on the <svg> element
      const fillColor = isDark ? '#ffffff' : `#${iconDef.color}`;
      processed = processed
        .replace(/\bwidth="[^"]*"/g, '')
        .replace(/\bheight="[^"]*"/g, '')
        .replace('<svg ', `<svg fill="${fillColor}" `);
    }

    // Add class for sizing
    processed = processed.replace('<svg ', '<svg class="h-full w-full" ');

    return (
      <div
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-muted/40 p-2"
        // Safe to use: SVGs are from bundled, trusted icon definitions (not user input)
        dangerouslySetInnerHTML={{ __html: processed }}
      />
    );
  }

  if (iconDef && iconDef.type === 'png' && iconDef.data) {
    return (
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-muted/40 p-2">
        <img src={iconDef.data} alt={name} className="h-full w-full object-contain" />
      </div>
    );
  }

  // Fallback: first letter
  const letter = name.charAt(0).toUpperCase();
  return (
    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-muted/40 text-sm font-semibold text-foreground/60">
      {letter}
    </div>
  );
};

export const McpServerCard: React.FC<McpServerCardProps> = ({
  server,
  catalogEntry,
  onEdit,
  onAdd,
}) => {
  const name = catalogEntry?.name ?? server?.name ?? 'Unknown';
  const description = catalogEntry?.description ?? (server ? `${server.transport} server` : '');
  const isInstalled = !!server;
  const transport =
    server?.transport ??
    (catalogEntry?.defaultConfig?.type === 'http' ||
    (catalogEntry?.defaultConfig &&
      'url' in catalogEntry.defaultConfig &&
      !('command' in catalogEntry.defaultConfig))
      ? 'http'
      : 'stdio');
  const docsUrl = catalogEntry?.docsUrl;

  // Get synced provider logos for installed servers
  const syncedProviders =
    isInstalled && server
      ? (server.providers
          .map((id) => {
            const config = agentConfig[id as Agent];
            return config ? { id, ...config } : null;
          })
          .filter(Boolean) as Array<{
          id: string;
          name: string;
          logo: string;
          alt: string;
          isSvg?: boolean;
          invertInDark?: boolean;
        }>)
      : [];

  const handleClick = () => {
    if (isInstalled && server) {
      onEdit(server);
    } else if (catalogEntry && onAdd) {
      onAdd(catalogEntry);
    }
  };

  const handleDocsClick = (e: React.MouseEvent) => {
    if (docsUrl) {
      e.stopPropagation();
      window.open(docsUrl, '_blank', 'noopener,noreferrer');
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
      className="group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-muted/20 p-4 text-left text-card-foreground shadow-sm transition-[background-color,box-shadow] hover:bg-muted/40 hover:shadow-md"
    >
      <McpIcon name={name} catalogKey={catalogEntry?.key ?? server?.name} />

      {/* Content */}
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
        <div className="mt-0.5 flex items-center gap-2">
          {description && (
            <p className="line-clamp-1 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {/* Synced provider logos */}
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

      {/* Actions */}
      <div className="flex flex-shrink-0 items-center gap-1 self-center">
        {docsUrl && (
          <button
            type="button"
            onClick={handleDocsClick}
            className="rounded-md p-1 text-muted-foreground opacity-0 transition-[background-color,color,opacity] hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 group-hover:opacity-100"
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
