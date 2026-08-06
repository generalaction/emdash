import { PageLayout } from '@emdash/ui/react/patterns';
import React, { useCallback, useMemo, useState } from 'react';
import { hostRefFromConnectionId } from '@core/features/agents/api/browser/client';
import { useAgentInstallationStatuses } from '@core/features/agents/api/browser/use-agent-installation-statuses';
import { AgentsToolbar } from './AgentsToolbar';
import { CliAgentsList, type AgentFilter } from './CliAgentsList';

type AgentsPanelProps = {
  connectionId?: string;
  header?: { title: string; description: string };
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  onManageMcp?: () => void;
};

export function AgentsPanel({
  connectionId,
  header,
  searchQuery: controlledSearchQuery,
  onSearchQueryChange,
  onManageMcp,
}: AgentsPanelProps) {
  const host = useMemo(() => hostRefFromConnectionId(connectionId), [connectionId]);
  const [localSearchQuery, setLocalSearchQuery] = useState('');
  const [filter, setFilter] = useState<AgentFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const { probeAll } = useAgentInstallationStatuses(host);
  const searchQuery = controlledSearchQuery ?? localSearchQuery;
  const setSearchQuery = onSearchQueryChange ?? setLocalSearchQuery;

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    probeAll(undefined, {
      onSettled: () => setRefreshing(false),
    });
  }, [probeAll]);

  const toolbar = (
    <AgentsToolbar
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      filter={filter}
      onFilterChange={setFilter}
      onRefresh={handleRefresh}
      isRefreshing={refreshing}
    />
  );

  const list = (
    <CliAgentsList
      searchQuery={searchQuery}
      filter={filter}
      connectionId={connectionId}
      onManageMcp={onManageMcp}
    />
  );

  if (header) {
    return (
      <>
        <PageLayout.Header
          sticky
          title={header.title}
          description={header.description}
          actions={toolbar}
        />
        <div className="flex flex-col gap-3">{list}</div>
      </>
    );
  }

  return (
    <>
      {toolbar}
      {list}
    </>
  );
}
