import { Button, SearchInput } from '@emdash/ui/react/primitives';
import { RefreshCw } from 'lucide-react';
import React from 'react';

type AgentsToolbarProps = {
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
};

export function AgentsToolbar({
  searchQuery,
  onSearchQueryChange,
  onRefresh,
  isRefreshing,
}: AgentsToolbarProps) {
  return (
    <div className="flex w-full items-center justify-between gap-2">
      <SearchInput
        placeholder="Search agents…"
        value={searchQuery}
        onChange={(event) => onSearchQueryChange(event.target.value)}
      />
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
  );
}
