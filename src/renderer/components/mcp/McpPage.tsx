import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Search, Plus, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { useToast } from '../../hooks/use-toast';
import { useModalContext } from '../../contexts/ModalProvider';
import { McpServerCard } from './McpServerCard';
import type { McpServerModalMode } from './McpServerModal';
import type { McpServer, McpCatalogEntry, McpProvidersResponse } from '@shared/mcp/types';

export const McpPage: React.FC = () => {
  const { toast } = useToast();
  const { showModal, closeModal } = useModalContext();
  const [installed, setInstalled] = useState<McpServer[]>([]);
  const [catalog, setCatalog] = useState<McpCatalogEntry[]>([]);
  const [providers, setProviders] = useState<McpProvidersResponse[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [loadResult, provResult] = await Promise.all([
        window.electronAPI.mcpLoadAll(),
        window.electronAPI.mcpGetProviders(),
      ]);
      if (loadResult.success && loadResult.data) {
        setInstalled(loadResult.data.installed);
        setCatalog(loadResult.data.catalog);
      }
      if (provResult.success && provResult.data) {
        setProviders(provResult.data);
      }
    } catch (err) {
      toast({ title: 'Failed to load MCP servers', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [loadResult, provResult] = await Promise.all([
        window.electronAPI.mcpLoadAll(),
        window.electronAPI.mcpRefreshProviders(),
      ]);
      if (loadResult.success && loadResult.data) {
        setInstalled(loadResult.data.installed);
        setCatalog(loadResult.data.catalog);
      }
      if (provResult.success && provResult.data) {
        setProviders(provResult.data);
      }
    } catch {
      toast({ title: 'Failed to refresh MCP data', variant: 'destructive' });
    } finally {
      setIsRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSave = async (server: McpServer) => {
    const result = await window.electronAPI.mcpSaveServer(server);
    if (!result.success) {
      toast({
        title: 'Failed to save server',
        description: result.error,
        variant: 'destructive',
      });
      throw new Error(result.error ?? 'Failed to save server');
    }
    await loadData();
  };

  const handleRemoveRequest = (serverName: string) => {
    closeModal();
    setRemoveTarget(serverName);
  };

  const executeRemove = async () => {
    if (!removeTarget) return;
    try {
      const result = await window.electronAPI.mcpRemoveServer(removeTarget);
      if (result.success) {
        await loadData();
      } else {
        toast({
          title: 'Failed to remove server',
          description: result.error,
          variant: 'destructive',
        });
      }
    } catch {
      toast({ title: 'Failed to remove server', variant: 'destructive' });
    } finally {
      setRemoveTarget(null);
    }
  };

  const openModal = (mode: McpServerModalMode) => {
    showModal('mcpServerModal', {
      mode,
      providers,
      onSave: handleSave,
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

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-8 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-lg font-semibold">MCP</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Connect your agents with external data sources and tools
          </p>
        </div>

        {/* Toolbar */}
        <div className="mb-6 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search servers..."
              className="pl-9"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={isRefreshing}
            aria-label="Refresh providers"
          >
            <RefreshCw
              className={`h-4 w-4 text-muted-foreground ${isRefreshing ? 'animate-spin' : ''}`}
            />
          </Button>
          <Button variant="outline" size="sm" onClick={() => openModal({ type: 'add-custom' })}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Custom MCP
          </Button>
        </div>

        {/* Installed */}
        {filteredInstalled.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">Added</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {filteredInstalled.map((server) => (
                <McpServerCard
                  key={server.name}
                  server={server}
                  catalogEntry={catalog.find((c) => c.key === server.name)}
                  onEdit={(s) => openModal({ type: 'edit', server: s })}
                />
              ))}
            </div>
          </div>
        )}

        {/* Recommended */}
        {filteredCatalog.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">
              Recommended
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {filteredCatalog.map((entry) => (
                <McpServerCard
                  key={entry.key}
                  catalogEntry={entry}
                  onEdit={() => {}}
                  onAdd={(e) => openModal({ type: 'add-catalog', entry: e })}
                />
              ))}
            </div>
          </div>
        )}

        {filteredInstalled.length === 0 && filteredCatalog.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {search ? 'No servers match your search.' : 'No servers available.'}
            </p>
          </div>
        )}
      </div>

      <AlertDialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove MCP server?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove &ldquo;{removeTarget}&rdquo; from all agents. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive px-4 py-2 text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void executeRemove()}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
