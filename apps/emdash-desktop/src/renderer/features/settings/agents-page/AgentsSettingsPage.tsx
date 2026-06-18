import { RefreshCw } from 'lucide-react';
import React, { useCallback, useState } from 'react';
import { PageHeader } from '@renderer/lib/components/page-header';
import { useAgentInstallationStatuses } from '@renderer/lib/stores/use-agent-installation-statuses';
import { Button } from '@renderer/lib/ui/button';
import { SearchInput } from '@renderer/lib/ui/search-input';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { CliAgentsList, type AgentFilter } from './CliAgentsList';

export function AgentsSettingsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<AgentFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const { probeAll } = useAgentInstallationStatuses();

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    probeAll(undefined, {
      onSettled: () => setRefreshing(false),
    });
  }, [probeAll]);

  return (
    <>
      <PageHeader sticky title="Agents" description="Manage CLI agents and model configurations.">
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
      </PageHeader>
      <div className="flex flex-col gap-3">
        <CliAgentsList searchQuery={searchQuery} filter={filter} onFilterChange={setFilter} />
      </div>
    </>
  );
}
