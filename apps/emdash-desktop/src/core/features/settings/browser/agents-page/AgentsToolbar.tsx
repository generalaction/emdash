import { CollectionToolbar } from '@emdash/ui/react/patterns';
import { Button } from '@emdash/ui/react/primitives';
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
    <CollectionToolbar.Root>
      <CollectionToolbar.Search
        value={searchQuery}
        onValueChange={onSearchQueryChange}
        placeholder="Search agents…"
      />
      <CollectionToolbar.Spacer />
      <CollectionToolbar.Group>
        <Button
          variant="secondary"
          icon
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label="Refresh agent detection"
        >
          <RefreshCw className={isRefreshing ? 'animate-spin' : ''} />
        </Button>
      </CollectionToolbar.Group>
    </CollectionToolbar.Root>
  );
}
