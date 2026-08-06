import { Button, SearchInput, ToggleGroup } from '@emdash/ui/react/primitives';
import { RefreshCw } from 'lucide-react';
import React from 'react';
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
      <ToggleGroup.Root
        multiple={false}
        value={[filter]}
        onValueChange={([value]) => {
          if (value) onFilterChange(value as AgentFilter);
        }}
      >
        <ToggleGroup.Item value="all">All</ToggleGroup.Item>
        <ToggleGroup.Item value="installed">Installed</ToggleGroup.Item>
        <ToggleGroup.Item value="uninstalled">Not installed</ToggleGroup.Item>
      </ToggleGroup.Root>
      <div className="flex items-center gap-2">
        <div className="w-56">
          <SearchInput
            placeholder="Search agents…"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
          />
        </div>
        <Button
          variant="secondary"
          icon
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
