import { Plus, RefreshCw } from 'lucide-react';
import React, { useState } from 'react';
import { Button } from '@core/primitives/ui/browser/button';
import { PageHeader } from '@core/primitives/ui/browser/components/page-header';
import { SearchInput } from '@core/primitives/ui/browser/search-input';
import type { McpDrawerMode } from '../../../browser/components/McpDrawer';
import { useMcps } from '../../../browser/components/useMcps';
import { McpServersList } from './McpServersList';

export const McpView: React.FC = () => {
  const mcp = useMcps();
  const [search, setSearch] = useState('');
  const [drawerMode, setDrawerMode] = useState<McpDrawerMode | null>(null);

  return (
    <div className="flex flex-col text-foreground">
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
              onClick={mcp.refresh}
              disabled={mcp.isRefreshing}
              aria-label="Refresh providers"
            >
              <RefreshCw
                className={`text-muted-foreground h-4 w-4 ${mcp.isRefreshing ? 'animate-spin' : ''}`}
              />
            </Button>
            <Button onClick={() => setDrawerMode({ type: 'add-custom' })}>
              <Plus className="size-4" />
              Custom MCP
            </Button>
          </div>
        </div>
      </PageHeader>

      <McpServersList
        mcp={mcp}
        search={search}
        drawerMode={drawerMode}
        onDrawerModeChange={setDrawerMode}
      />
    </div>
  );
};
