import { Loader2, Plus, RefreshCw } from 'lucide-react';
import React, { useState } from 'react';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { Button } from '@core/primitives/ui/browser/button';
import { CardGridSection } from '@core/primitives/ui/browser/components/card-grid';
import { PageHeader } from '@core/primitives/ui/browser/components/page-header';
import { SearchInput } from '@core/primitives/ui/browser/search-input';
import { McpCard } from '../../../browser/components/McpCard';
import { McpDrawer, type McpDrawerMode } from '../../../browser/components/McpDrawer';
import { useMcps } from '../../../browser/components/useMcps';

export const McpView: React.FC = () => {
  const {
    installed,
    catalog,
    providers,
    isLoading,
    isRefreshing,
    saveServer,
    removeServer,
    refresh,
  } = useMcps();

  const openConfirm = useOpenModal('confirmActionModal');
  const [search, setSearch] = useState('');
  const [drawerMode, setDrawerMode] = useState<McpDrawerMode | null>(null);

  const handleRemoveRequest = (serverName: string) => {
    setDrawerMode(null);
    void openConfirm({
      title: 'Remove MCP server?',
      description: `This will remove "${serverName}" from all agents. This action cannot be undone.`,
      confirmLabel: 'Remove',
    }).then((outcome) => {
      if (outcome.success) void removeServer(serverName);
    });
  };

  const openDrawer = (mode: McpDrawerMode) => {
    setDrawerMode(mode);
  };

  const drawerSource =
    drawerMode?.type === 'add-catalog'
      ? 'catalog'
      : drawerMode?.type === 'add-custom'
        ? 'custom'
        : null;

  // Filter
  const lowerSearch = search.toLowerCase();
  const installedNames = new Set(installed.map((s) => s.name));
  const filteredInstalled = installed.filter(
    (s) => !search || s.name.toLowerCase().includes(lowerSearch)
  );
  const filteredCatalog = catalog.filter(
    (c) =>
      !installedNames.has(c.key) &&
      (!search ||
        c.name.toLowerCase().includes(lowerSearch) ||
        c.description.toLowerCase().includes(lowerSearch))
  );

  if (isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center text-foreground">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col text-foreground">
      <McpDrawer
        open={drawerMode !== null}
        mode={drawerMode}
        providers={providers}
        onOpenChange={(open) => {
          if (!open) setDrawerMode(null);
        }}
        onSave={(server) => saveServer(server, drawerSource)}
        onRemove={handleRemoveRequest}
      />
      <PageHeader
        sticky
        title="MCP"
        description="Connect your agents with external data sources and tools"
      >
        <div className="flex w-full items-center justify-between gap-2">
          <SearchInput
            placeholder="Search servers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={refresh}
              disabled={isRefreshing}
              aria-label="Refresh providers"
            >
              <RefreshCw
                className={`text-muted-foreground h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
              />
            </Button>
            <Button onClick={() => openDrawer({ type: 'add-custom' })}>
              <Plus className="size-4" />
              Custom MCP
            </Button>
          </div>
        </div>
      </PageHeader>

      <div className="flex flex-col gap-8 py-8">
        {filteredInstalled.length > 0 && (
          <CardGridSection title="Added">
            {filteredInstalled.map((server) => (
              <McpCard
                key={server.name}
                server={server}
                catalogEntry={catalog.find((c) => c.key === server.name)}
                onEdit={(s) => openDrawer({ type: 'edit', server: s })}
              />
            ))}
          </CardGridSection>
        )}

        {filteredCatalog.length > 0 && (
          <CardGridSection title="Recommended">
            {filteredCatalog.map((entry) => (
              <McpCard
                key={entry.key}
                catalogEntry={entry}
                onAdd={(e) => openDrawer({ type: 'add-catalog', entry: e })}
              />
            ))}
          </CardGridSection>
        )}

        {filteredInstalled.length === 0 && filteredCatalog.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-muted-foreground text-sm">
              {search ? 'No servers match your search.' : 'No servers available.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
