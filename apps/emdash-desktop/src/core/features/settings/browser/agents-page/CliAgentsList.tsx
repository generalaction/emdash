import { CollectionView } from '@emdash/ui/react/patterns';
import { Spinner } from '@emdash/ui/react/primitives';
import { BotIcon } from 'lucide-react';
import { observable, runInAction } from 'mobx';
import React, { useLayoutEffect, useState } from 'react';
import { hostRefFromConnectionId } from '@core/features/agents/api/browser/client';
import { useAgents } from '@core/features/agents/api/browser/use-agents';
import { AgentDetailSheet } from '@core/features/settings/browser/agents-page/AgentDetailSheet';
import { AgentRow } from '@core/features/settings/browser/agents-page/AgentRow';
import { createAgentsListView } from '@core/features/settings/browser/agents-page/agents-list-model';
import type { AgentPayload } from '@core/primitives/agents/api';

type CliAgentsListProps = {
  searchQuery?: string;
  connectionId?: string;
  onManageMcp?: () => void;
  /** Sticky toolbar row rendered inside the list card. */
  toolbar?: React.ReactNode;
};

export const CliAgentsList: React.FC<CliAgentsListProps> = ({
  searchQuery = '',
  connectionId,
  onManageMcp,
  toolbar,
}) => {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const host = hostRefFromConnectionId(connectionId);
  const agentsQuery = useAgents(host);

  // Bridge the query data into the view's sync source: seed the box so the
  // first render sees data, and update before paint to avoid an empty flash.
  const [itemsBox] = useState(() =>
    observable.box<AgentPayload[]>(agentsQuery.data ?? [], { deep: false })
  );
  const [view] = useState(() => createAgentsListView(() => itemsBox.get()));
  useLayoutEffect(() => {
    runInAction(() => itemsBox.set(agentsQuery.data ?? []));
  }, [agentsQuery.data, itemsBox]);

  // The search query is owned outside the view (settings search context or the
  // panel's local state); mirror it into the view's search slice.
  useLayoutEffect(() => {
    view.store.search?.setQuery(searchQuery);
  }, [searchQuery, view]);

  const hasAgents = (agentsQuery.data?.length ?? 0) > 0;

  return (
    <>
      <view.Root>
        <CollectionView
          view={view}
          renderRow={(agent) => <AgentRow agent={agent} />}
          density="compact"
          toolbar={toolbar}
          onItemClick={(agent) => setSelectedAgentId(agent.id)}
          emptySlot={
            agentsQuery.isPending ? (
              <AgentsLoadingState />
            ) : (
              <AgentsEmptyState hasAgents={hasAgents} />
            )
          }
        />
      </view.Root>
      <AgentDetailSheet
        agentId={selectedAgentId}
        connectionId={connectionId}
        onManageMcp={onManageMcp}
        onClose={() => setSelectedAgentId(null)}
      />
    </>
  );
};

// The view's sync source is never "loading", so the query's pending state
// routes through the empty slot rather than CollectionView's loadingSlot.
function AgentsLoadingState() {
  return (
    <div className="flex min-h-48 items-center justify-center p-8">
      <Spinner />
    </div>
  );
}

function AgentsEmptyState({ hasAgents }: { hasAgents: boolean }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center p-8 text-center">
      <BotIcon className="mb-3 size-8 text-foreground-passive" />
      <div className="text-sm text-foreground">
        {hasAgents ? 'No agents match your search' : 'No agents'}
      </div>
      <p className="mt-1 max-w-sm text-xs text-foreground-passive">
        {hasAgents
          ? 'Try a different agent name.'
          : 'Agents appear here once they can be detected on this machine.'}
      </p>
    </div>
  );
}
