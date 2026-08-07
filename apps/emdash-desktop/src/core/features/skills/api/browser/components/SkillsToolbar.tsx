import { Button, SearchInput } from '@emdash/ui/react/primitives';
import { Plus, RefreshCw } from 'lucide-react';
import React from 'react';
import { useSearchFocusHotkeys } from '@core/primitives/keybindings/browser';

type SkillsToolbarProps = {
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onCreateSkill: () => void;
};

export function SkillsToolbar({
  searchQuery,
  onSearchQueryChange,
  onRefresh,
  isRefreshing,
  onCreateSkill,
}: SkillsToolbarProps) {
  const searchRef = useSearchFocusHotkeys();
  return (
    <div className="flex w-full items-center justify-between gap-2">
      <SearchInput
        ref={searchRef}
        placeholder="Search skills..."
        value={searchQuery}
        onChange={(event) => onSearchQueryChange(event.target.value)}
      />
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          icon
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label="Refresh catalog"
        >
          <RefreshCw
            className={`text-muted-foreground h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
          />
        </Button>
        <Button variant="primary" onClick={onCreateSkill}>
          <Plus className="size-4" />
          New Skill
        </Button>
      </div>
    </div>
  );
}
