import { Button, SearchInput } from '@emdash/ui/react/primitives';
import { Plus, RefreshCw } from 'lucide-react';
import React from 'react';
import { useSearchFocusHotkeys } from '@core/primitives/keybindings/browser';

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
  const searchRef = useSearchFocusHotkeys();
  return (
    <div className="flex w-full items-center justify-between gap-2">
      <SearchInput
        ref={searchRef}
        placeholder="Search servers..."
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
      />
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          icon
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label="Refresh providers"
        >
          <RefreshCw
            className={`text-muted-foreground h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
          />
        </Button>
        <Button variant="primary" onClick={onAddCustom}>
          <Plus className="size-4" />
          Custom MCP
        </Button>
      </div>
    </div>
  );
}
