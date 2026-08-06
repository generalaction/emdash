import { RefreshCw } from 'lucide-react';
import React from 'react';
import { Button } from '@core/primitives/ui/browser/button';
import { SearchInput } from '@core/primitives/ui/browser/search-input';
import { ToggleGroup, ToggleGroupItem } from '@core/primitives/ui/browser/toggle-group';
import type { AgentFilter } from './CliAgentsList';

type AgentsToolbarProps = {
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  filter: AgentFilter;
  onFilterChange: (filter: AgentFilter) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
};

export function AgentsToolbar({
  searchQuery,
  onSearchQueryChange,
  filter,
  onFilterChange,
  onRefresh,
  isRefreshing,
}: AgentsToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <ToggleGroup
        multiple={false}
        value={[filter]}
        onValueChange={([value]) => {
          if (value) onFilterChange(value as AgentFilter);
        }}
      >
        <ToggleGroupItem value="all">All</ToggleGroupItem>
        <ToggleGroupItem value="installed">Installed</ToggleGroupItem>
        <ToggleGroupItem value="uninstalled">Not installed</ToggleGroupItem>
      </ToggleGroup>
      <div className="flex items-center gap-2">
        <SearchInput
          placeholder="Search agents…"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          containerClassName="w-56"
          focusHotkey={false}
        />
        <Button
          variant="outline"
          size="icon"
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label="Refresh agent detection"
        >
          <RefreshCw className={isRefreshing ? 'animate-spin' : ''} />
        </Button>
      </div>
    </div>
  );
}
