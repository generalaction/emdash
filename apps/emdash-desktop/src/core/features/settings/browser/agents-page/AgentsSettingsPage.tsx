import React from 'react';
import { AgentsPanel } from '@core/features/settings/api/browser/agents-page/AgentsPanel';
import { useSettingsSearch } from '@core/features/settings/browser/search/settings-search-context';

export function AgentsSettingsPage() {
  const { query: settingsSearchQuery, setQuery: setSettingsSearchQuery } = useSettingsSearch();

  return (
    <AgentsPanel
      header={{ title: 'Agents', description: 'Manage agents and model configurations.' }}
      searchQuery={settingsSearchQuery}
      onSearchQueryChange={setSettingsSearchQuery}
    />
  );
}
