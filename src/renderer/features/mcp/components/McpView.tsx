import { Loader2, Plus, RefreshCw } from 'lucide-react';
import React, { useState } from 'react';
import { CardGridSection } from '@renderer/lib/components/card-grid';
import { PageHeader } from '@renderer/lib/components/page-header';
import { useModalContext, useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { SearchInput } from '@renderer/lib/ui/search-input';
import { McpCard } from './McpCard';
import type { McpModalMode } from './McpModal';
import { useMcps } from './useMcps';

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

  const { showModal, closeModal } = useModalContext();
  const showConfirm = useShowModal('confirmActionModal');
  const [search, setSearch] = useState('');

  const handleRemoveRequest = (serverName: string) => {
    closeModal();
    showConfirm({
      title: 'Remove MCP server?',
      description: `This will remove "${serverName}" from all agents. This action cannot be undone.`,
      confirmLabel: 'Remove',
      onSuccess: () => void removeServer(serverName),
    });
  };

  const openModal = (mode: McpModalMode) => {
    const source =
      mode.type === 'add-catalog' ? 'catalog' : mode.type === 'add-custom' ? 'custom' : null;
    showModal('mcpServerModal', {
      mode,
      providers,
      onSave: (server) => saveServer(server, source),
      onRemove: handleRemoveRequest,
    });
  };

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
      <div className="flex h-full items-center justify-center bg-background text-foreground">
        <Loader2 className="text-muted-foreground size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto text-foreground">
      <div className="mx-auto w-full max-w-3xl p-8">
        <PageHeader
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
                  className={`text-muted-foreground size-4 ${isRefreshing ? 'animate-spin' : ''}`}
                />
              </Button>
              <Button onClick={() => openModal({ type: 'add-custom' })}>
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
                  onEdit={(s) => openModal({ type: 'edit', server: s })}
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
                  onEdit={() => {}}
                  onAdd={(e) => openModal({ type: 'add-catalog', entry: e })}
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
    </div>
  );
};
