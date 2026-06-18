import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useAgents } from '@renderer/lib/stores/use-agents';
import { Label } from '@renderer/lib/ui/label';
import { Separator } from '@renderer/lib/ui/separator';
import type { AgentPayload } from '@shared/core/agents/agent-payload';
import { isValidProviderId } from '@shared/core/agents/agent-provider-registry';
import type { AppSettings } from '@shared/core/app-settings';
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

const RECOMMENDED_IDS = new Set(['claude', 'codex', 'gemini', 'pi']);

type CliAgentsListProps = {
  searchQuery?: string;
  filter?: AgentFilter;
  onFilterChange?: (filter: AgentFilter) => void;
};

export const CliAgentsList: React.FC<CliAgentsListProps> = ({
  searchQuery = '',
  filter = 'all',
}) => {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const defaultAgentSaveInFlight = useRef(false);
  const { data: agentPayloads } = useAgents();
  const {
    value: defaultAgentValue,
    updateAsync: updateDefaultAgent,
    isSaving: isSavingDefaultAgent,
  } = useAppSettingsKey('defaultAgent');
  const defaultAgentId = isValidProviderId(defaultAgentValue) ? defaultAgentValue : 'claude';
  const normalizedQuery = searchQuery.toLowerCase();

  const handleSetDefault = useCallback(
    (id: string) => {
      if (!isValidProviderId(id) || defaultAgentSaveInFlight.current) return;

      defaultAgentSaveInFlight.current = true;
      void updateDefaultAgent(id as AppSettings['defaultAgent'])
        .catch(() => {
          // useAppSettingsKey handles rollback/invalidation; avoid an unhandled rejection here.
        })
        .finally(() => {
          defaultAgentSaveInFlight.current = false;
        });
    },
    [updateDefaultAgent]
  );

  // Only installed agents can be the default — the default is preselected when
  // creating a task, and an uninstalled agent cannot run one.
  const renderRow = useCallback(
    (agent: AgentPayload) => (
      <div key={agent.id} className="w-full py-0.5">
        <AgentRow
          agent={agent}
          onClick={() => setSelectedAgentId(agent.id)}
          isDefault={agent.id === defaultAgentId}
          onSetDefault={
            agent.status === 'available' && !isSavingDefaultAgent
              ? () => handleSetDefault(agent.id)
              : undefined
          }
        />
      </div>
    ),
    [defaultAgentId, handleSetDefault, isSavingDefaultAgent]
  );

  const allAgents = useMemo(
    () =>
      (agentPayloads ?? [])
        .filter((a) => !normalizedQuery || a.name.toLowerCase().includes(normalizedQuery))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [agentPayloads, normalizedQuery]
  );

  const installed = useMemo(() => allAgents.filter((a) => a.status === 'available'), [allAgents]);

  const uninstalled = useMemo(() => allAgents.filter((a) => a.status !== 'available'), [allAgents]);

  // "All" tab: recommended agents (any install status) + all others alphabetically
  const allRecommended = useMemo(
    () => allAgents.filter((a) => RECOMMENDED_IDS.has(a.id)),
    [allAgents]
  );
  const allOthers = useMemo(() => allAgents.filter((a) => !RECOMMENDED_IDS.has(a.id)), [allAgents]);

  // "Uninstalled" tab: recommended uninstalled first, then the rest
  const uninstalledRecommended = useMemo(
    () => uninstalled.filter((a) => RECOMMENDED_IDS.has(a.id)),
    [uninstalled]
  );
  const uninstalledRest = useMemo(
    () => uninstalled.filter((a) => !RECOMMENDED_IDS.has(a.id)),
    [uninstalled]
  );

  if (filter === 'all') {
    return (
      <div className="pb-4">
        {allRecommended.length > 0 && (
          <div className="pt-4">
            <SectionLabel totalCount={allRecommended.length}>Recommended</SectionLabel>
            {allRecommended.map(renderRow)}
          </div>
        )}
        {allOthers.length > 0 && (
          <div className="pt-4">
            <SectionLabel totalCount={allOthers.length}>All agents</SectionLabel>
            {allOthers.map(renderRow)}
          </div>
        )}
        <AgentDetailSheet agentId={selectedAgentId} onClose={() => setSelectedAgentId(null)} />
      </div>
    );
  }

  if (filter === 'installed') {
    return (
      <div className="pb-4">
        {installed.length > 0 && (
          <div className="pt-4">
            <SectionLabel totalCount={installed.length}>Installed</SectionLabel>
            {installed.map(renderRow)}
          </div>
        )}
        <AgentDetailSheet agentId={selectedAgentId} onClose={() => setSelectedAgentId(null)} />
      </div>
    );
  }

  // filter === 'uninstalled'
  return (
    <div className="pb-4">
      {uninstalledRecommended.length > 0 && (
        <div className="pt-4">
          <SectionLabel totalCount={uninstalledRecommended.length}>Recommended</SectionLabel>
          {uninstalledRecommended.map(renderRow)}
        </div>
      )}
      {uninstalledRest.length > 0 && (
        <>
          {uninstalledRecommended.length > 0 && <Separator />}
          <div className="pt-4">
            <SectionLabel totalCount={uninstalledRest.length}>Not installed</SectionLabel>
            {uninstalledRest.map(renderRow)}
          </div>
        </>
      )}
      <AgentDetailSheet agentId={selectedAgentId} onClose={() => setSelectedAgentId(null)} />
    </div>
  );
};
