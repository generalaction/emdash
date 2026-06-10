import { ArrowRightIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useMemo, useState } from 'react';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { Label } from '@renderer/lib/ui/label';
import { Separator } from '@renderer/lib/ui/separator';
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

const MAX_INSTALLED_PREVIEW = 4;

type CliAgentsListProps = {
  searchQuery?: string;
  filter?: AgentFilter;
  onFilterChange?: (filter: AgentFilter) => void;
};

export const CliAgentsList: React.FC<CliAgentsListProps> = observer(
  ({ searchQuery = '', filter = 'all', onFilterChange }) => {
    const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
    const agentPayloads = appState.dependencies.agents.data;
    const normalizedQuery = searchQuery.toLowerCase();

    const installed = useMemo(
      () =>
        (agentPayloads ?? [])
          .filter((a) => a.status === 'available')
          .filter((a) => !normalizedQuery || a.name.toLowerCase().includes(normalizedQuery))
          .sort((a, b) => a.name.localeCompare(b.name)),
      [agentPayloads, normalizedQuery]
    );

    const supported = useMemo(
      () =>
        (agentPayloads ?? [])
          .filter((a) => a.status !== 'available')
          .filter((a) => !normalizedQuery || a.name.toLowerCase().includes(normalizedQuery))
          .sort((a, b) => a.name.localeCompare(b.name)),
      [agentPayloads, normalizedQuery]
    );

    const showInstalled = filter === 'all' || filter === 'installed';
    const showSupported = filter === 'all' || filter === 'uninstalled';

    const visibleInstalled =
      filter === 'all' ? installed.slice(0, MAX_INSTALLED_PREVIEW) : installed;
    const hasMoreInstalled = filter === 'all' && installed.length > MAX_INSTALLED_PREVIEW;

    return (
      <div className="pb-4">
        {showInstalled && installed.length > 0 && (
          <div className="py-2">
            <SectionLabel totalCount={installed.length}>Installed</SectionLabel>
            {visibleInstalled.map((agent) => (
              <div key={agent.id} className="w-full py-0.5">
                <AgentRow agent={agent} onClick={() => setSelectedAgentId(agent.id)} />
              </div>
            ))}
            {hasMoreInstalled && (
              <Button
                variant="link"
                className="text-xs text-foreground-muted hover:text-foreground"
                onClick={() => onFilterChange?.('installed')}
              >
                <ArrowRightIcon className="size-3.5" />
                View all installed agents
              </Button>
            )}
          </div>
        )}

        {showSupported && supported.length > 0 && (
          <>
            {showInstalled && installed.length > 0 && <Separator />}

            <div className="py-2">
              <SectionLabel totalCount={supported.length}>Uninstalled</SectionLabel>
              {supported.map((agent) => (
                <div key={agent.id} className="w-full py-0.5">
                  <AgentRow agent={agent} onClick={() => setSelectedAgentId(agent.id)} />
                </div>
              ))}
            </div>
          </>
        )}
        <AgentDetailSheet agentId={selectedAgentId} onClose={() => setSelectedAgentId(null)} />
      </div>
    );
  }
);
