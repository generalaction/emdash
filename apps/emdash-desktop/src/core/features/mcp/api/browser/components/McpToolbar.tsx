import { Plus, RefreshCw } from 'lucide-react';
import React from 'react';
import { Button } from '@core/primitives/ui/browser/button';
import { SearchInput } from '@core/primitives/ui/browser/search-input';

type McpToolbarProps = {
  search: string;
  onSearchChange: (search: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onAddCustom: () => void;
};

export function McpToolbar({
  search,
  onSearchChange,
  onRefresh,
  isRefreshing,
  onAddCustom,
}: McpToolbarProps) {
  return (
    <div className="flex w-full items-center justify-between gap-2">
      <SearchInput
        placeholder="Search servers..."
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
      />
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label="Refresh providers"
        >
          <RefreshCw
            className={`text-muted-foreground h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
          />
        </Button>
        <Button onClick={onAddCustom}>
          <Plus className="size-4" />
          Custom MCP
        </Button>
      </div>
    </div>
  );
}
