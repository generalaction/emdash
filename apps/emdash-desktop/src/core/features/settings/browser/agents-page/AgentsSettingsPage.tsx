import { PageLayout } from '@emdash/ui/react/patterns';
import { RefreshCw } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useAgentInstallationStatuses } from '@core/features/agents/api/browser/use-agent-installation-statuses';
import { useSettingsSearch } from '@core/features/settings/browser/search/settings-search-context';
import { Button } from '@core/primitives/ui/browser/button';
import { SearchInput } from '@core/primitives/ui/browser/search-input';
import { ToggleGroup, ToggleGroupItem } from '@core/primitives/ui/browser/toggle-group';
import { CliAgentsList, type AgentFilter } from './CliAgentsList';

export function AgentsSettingsPage() {
  const { query: settingsSearchQuery } = useSettingsSearch();
  const [searchQuery, setSearchQuery] = useState(settingsSearchQuery);
  const [filter, setFilter] = useState<AgentFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const { probeAll } = useAgentInstallationStatuses();

  useEffect(() => {
    setSearchQuery(settingsSearchQuery);
  }, [settingsSearchQuery]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    probeAll(undefined, {
      onSettled: () => setRefreshing(false),
    });
  }, [probeAll]);

  return (
    <>
      <PageLayout.Header
        sticky
        title="Agents"
        description="Manage agents and model configurations."
        actions={
          <>
            {/* <DefaultAgentSelector /> */}
            <div className="flex items-center justify-between gap-2">
              <ToggleGroup
                multiple={false}
                value={[filter]}
                onValueChange={([value]) => {
                  if (value) setFilter(value as AgentFilter);
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
                  onChange={(e) => setSearchQuery(e.target.value)}
                  containerClassName="w-56"
                  focusHotkey={false}
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => void handleRefresh()}
                  disabled={refreshing}
                  aria-label="Refresh agent detection"
                >
                  <RefreshCw className={refreshing ? 'animate-spin' : ''} />
                </Button>
              </div>
            </div>
          </>
        }
      />
      <div className="flex flex-col gap-3">
        <CliAgentsList searchQuery={searchQuery} filter={filter} onFilterChange={setFilter} />
      </div>
    </>
  );
}
