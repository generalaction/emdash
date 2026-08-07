import { Label, Separator } from '@emdash/ui/react/primitives';
import React, { useMemo, useState } from 'react';
import { hostRefFromConnectionId } from '@core/features/agents/api/browser/client';
import { useAgents } from '@core/features/agents/api/browser/use-agents';
import { buildAgentSections } from '@core/features/settings/browser/agents-page/agent-list-sections';
import { AgentDetailSheet } from '@core/features/settings/browser/agents-page/AgentDetailSheet';
import { AgentRow } from '@core/features/settings/browser/agents-page/AgentRow';

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

type CliAgentsListProps = {
  searchQuery?: string;
  connectionId?: string;
  onManageMcp?: () => void;
};

export const CliAgentsList: React.FC<CliAgentsListProps> = ({
  searchQuery = '',
  connectionId,
  onManageMcp,
}) => {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const host = hostRefFromConnectionId(connectionId);
  const { data: agentPayloads } = useAgents(host);
  const sections = useMemo(
    () => buildAgentSections(agentPayloads ?? [], searchQuery),
    [agentPayloads, searchQuery]
  );

  const visibleSections = sections.filter((section) => section.agents.length > 0);

  return (
    <div className="pb-4">
      {visibleSections.map((section, index) => (
        <React.Fragment key={section.label}>
          {index > 0 && <Separator />}
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
