import React, { useState } from 'react';
import { AgentProviderId } from '@shared/agent-provider-registry';
import { useDependencies } from '@renderer/core/dependencies-provider';
import { useRemoteInstalledAgents } from '@renderer/hooks/useRemoteInstalledAgents';
import { cn } from '@renderer/lib/utils';
import { agentConfig } from '../lib/agentConfig';
import AgentLogo from './agent-logo';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from './ui/combobox';

interface AgentOption {
  value: string;
  label: string;
  agentId: AgentProviderId;
}

interface AgentSelectorProps {
  value: AgentProviderId;
  onChange: (agent: AgentProviderId) => void;
  disabled?: boolean;
  className?: string;
  connectionId?: string;
}

export const AgentSelector: React.FC<AgentSelectorProps> = ({
  value,
  onChange,
  disabled = false,
  className = '',
  connectionId,
}) => {
  const { installedAgents: localAgents } = useDependencies();
  const { data: remoteAgents } = useRemoteInstalledAgents(connectionId);
  const installedAgents = connectionId ? (remoteAgents ?? []) : localAgents;
  const [open, setOpen] = useState(false);

  const options: AgentOption[] = installedAgents
    .filter((id): id is AgentProviderId => id in agentConfig)
    .map((id) => ({
      value: id,
      label: agentConfig[id as AgentProviderId].name,
      agentId: id as AgentProviderId,
    }));

  const selectedConfig = agentConfig[value];
  const selectedOption = options.find((o) => o.value === value);

  function handleValueChange(item: AgentOption | null) {
    if (!item || disabled) return;
    onChange(item.agentId);
    setOpen(false);
  }

  return (
    <div className={cn('relative block min-w-0', className)}>
      <Combobox
        items={[{ value: 'options', items: options }]}
        value={selectedOption ?? null}
        onValueChange={handleValueChange}
        open={open}
        onOpenChange={disabled ? undefined : setOpen}
        isItemEqualToValue={(a: AgentOption, b: AgentOption) => a.value === b.value}
        filter={(item: AgentOption, query) =>
          item.label.toLowerCase().includes(query.toLowerCase())
        }
        autoHighlight
      >
        <ComboboxTrigger
          disabled={disabled}
          className={cn(
            'flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-border bg-transparent px-2.5 py-1 text-sm outline-none',
            disabled && 'cursor-not-allowed opacity-60'
          )}
        >
          {selectedConfig ? (
            <>
              <AgentLogo
                logo={selectedConfig.logo}
                alt={selectedConfig.alt}
                isSvg={selectedConfig.isSvg}
                invertInDark={selectedConfig.invertInDark}
                className="h-4 w-4 shrink-0 rounded-sm"
              />
              <span className="flex-1 truncate text-left">{selectedConfig.name}</span>
            </>
          ) : (
            <span className="flex-1 truncate text-muted-foreground">Select agent</span>
          )}
        </ComboboxTrigger>
        <ComboboxContent className="min-w-(--anchor-width)">
          <ComboboxInput showTrigger={false} placeholder="Search agents..." />
          <ComboboxList className="pb-0">
            {(group: { value: string; items: AgentOption[] }) => (
              <ComboboxGroup key={group.value} items={group.items} className="py-1">
                <ComboboxCollection>
                  {(item: AgentOption) => {
                    const config = agentConfig[item.agentId];
                    return (
                      <ComboboxItem key={item.value} value={item}>
                        {config && (
                          <AgentLogo
                            logo={config.logo}
                            alt={config.alt}
                            isSvg={config.isSvg}
                            invertInDark={config.invertInDark}
                            className="h-4 w-4 shrink-0 rounded-sm"
                          />
                        )}
                        {item.label}
                      </ComboboxItem>
                    );
                  }}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
};
