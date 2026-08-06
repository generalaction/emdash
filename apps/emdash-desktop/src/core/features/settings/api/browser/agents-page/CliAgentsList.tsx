import { Label, Separator } from '@emdash/ui/react/primitives';
import React, { useMemo, useState } from 'react';
import { hostRefFromConnectionId } from '@core/features/agents/api/browser/client';
import { useAgents } from '@core/features/agents/api/browser/use-agents';
import type { AgentPayload } from '@core/primitives/agents/api';
import { AgentDetailSheet } from './AgentDetailSheet';
import { AgentRow } from './AgentRow';

const SectionLabel: React.FC<{ children: React.ReactNode; totalCount: number }> = ({
  children,
  totalCount,
}) => (
  <div className="px-3 py-2">
    <Label>
      {children}
      {` (${totalCount})`}
    </Label>
  </div>
);

export type AgentFilter = 'all' | 'installed' | 'uninstalled';

const RECOMMENDED_IDS = new Set(['claude', 'codex', 'pi']);

type AgentSection = {
  label: string;
  agents: AgentPayload[];
  separatorBefore?: boolean;
};

type CliAgentsListProps = {
  searchQuery?: string;
  filter?: AgentFilter;
  onFilterChange?: (filter: AgentFilter) => void;
  connectionId?: string;
  onManageMcp?: () => void;
};

export const CliAgentsList: React.FC<CliAgentsListProps> = ({
  searchQuery = '',
  filter = 'all',
  connectionId,
  onManageMcp,
}) => {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const host = hostRefFromConnectionId(connectionId);
  const { data: agentPayloads } = useAgents(host);
  const normalizedQuery = searchQuery.toLowerCase();

  const sections = useMemo<AgentSection[]>(() => {
    const allAgents = (agentPayloads ?? [])
      .filter((a) => !normalizedQuery || a.name.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (filter === 'installed') {
      return [{ label: 'Installed', agents: allAgents.filter((a) => a.status === 'available') }];
    }

    if (filter === 'uninstalled') {
      const uninstalled = allAgents.filter((a) => a.status !== 'available');
      return [
        { label: 'Recommended', agents: uninstalled.filter((a) => RECOMMENDED_IDS.has(a.id)) },
        {
          label: 'Not installed',
          agents: uninstalled.filter((a) => !RECOMMENDED_IDS.has(a.id)),
          separatorBefore: true,
        },
      ];
    }

    // "All" tab: recommended agents (any install status) + all others alphabetically.
    return [
      { label: 'Recommended', agents: allAgents.filter((a) => RECOMMENDED_IDS.has(a.id)) },
      { label: 'All agents', agents: allAgents.filter((a) => !RECOMMENDED_IDS.has(a.id)) },
    ];
  }, [agentPayloads, normalizedQuery, filter]);

  const visibleSections = sections.filter((section) => section.agents.length > 0);

  return (
    <div className="pb-4">
      {visibleSections.map((section, index) => (
        <React.Fragment key={section.label}>
          {section.separatorBefore && index > 0 && <Separator />}
          <div className="pt-4">
            <SectionLabel totalCount={section.agents.length}>{section.label}</SectionLabel>
            {section.agents.map((agent) => (
              <div key={agent.id} className="w-full py-0.5">
                <AgentRow agent={agent} onClick={() => setSelectedAgentId(agent.id)} />
              </div>
            ))}
          </div>
        </React.Fragment>
      ))}
      <AgentDetailSheet
        agentId={selectedAgentId}
        connectionId={connectionId}
        onManageMcp={onManageMcp}
        onClose={() => setSelectedAgentId(null)}
      />
    </div>
  );
};
