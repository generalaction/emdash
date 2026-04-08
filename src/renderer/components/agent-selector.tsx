import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';
import { AgentProviderId } from '@shared/agent-provider-registry';
import { appState } from '@renderer/core/stores/app-state';
import { cn } from '@renderer/lib/utils';
import { agentConfig } from '../lib/agentConfig';
import AgentLogo from './agent-logo';
import AgentTooltipRow from './agent-tooltip-row';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
} from './ui/combobox';
import { TooltipProvider } from './ui/tooltip';

interface AgentOption {
  value: string;
  label: string;
  agentId: AgentProviderId;
  disabled: boolean;
}

interface AgentGroup {
  value: string;
  label: string;
  items: AgentOption[];
}

interface AgentSelectorProps {
  value: AgentProviderId;
  onChange: (agent: AgentProviderId) => void;
  disabled?: boolean;
  className?: string;
  connectionId?: string;
}

export const AgentSelector: React.FC<AgentSelectorProps> = observer(
  ({ value, onChange, disabled = false, className = '', connectionId }) => {
    const installedAgents = connectionId
      ? appState.dependencies.remoteInstalledAgents(connectionId)
      : appState.dependencies.localInstalledAgents;
    const [open, setOpen] = useState(false);

    const installedSet = new Set(installedAgents.filter((id) => id in agentConfig));
    const allAgentIds = Object.keys(agentConfig) as AgentProviderId[];

    const installedOptions: AgentOption[] = allAgentIds
      .filter((id) => installedSet.has(id))
      .map((id) => ({ value: id, label: agentConfig[id].name, agentId: id, disabled: false }));

    const notInstalledOptions: AgentOption[] = allAgentIds
      .filter((id) => !installedSet.has(id))
      .map((id) => ({ value: id, label: agentConfig[id].name, agentId: id, disabled: true }));

    const groups: AgentGroup[] = [
      { value: 'installed', label: 'Installed', items: installedOptions },
      { value: 'not-installed', label: 'Not installed', items: notInstalledOptions },
    ].filter((g) => g.items.length > 0);

    const allOptions = [...installedOptions, ...notInstalledOptions];

    const selectedConfig = agentConfig[value];
    const selectedOption = allOptions.find((o) => o.value === value);

    function handleValueChange(item: AgentOption | null) {
      if (!item || disabled || item.disabled) return;
      onChange(item.agentId);
      setOpen(false);
    }

    return (
      <div className={cn('relative block min-w-0', className)}>
        <Combobox
          items={groups}
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
            <TooltipProvider delay={150}>
              <ComboboxList className="pb-0">
                {(group: AgentGroup) => (
                  <ComboboxGroup key={group.value} items={group.items} className="py-1">
                    <ComboboxLabel>{group.label}</ComboboxLabel>
                    <ComboboxCollection>
                      {(item: AgentOption) => {
                        const config = agentConfig[item.agentId];
                        return (
                          <AgentTooltipRow key={item.value} id={item.agentId}>
                            <ComboboxItem
                              value={item}
                              disabled={item.disabled}
                              className={cn(
                                item.disabled &&
                                  'data-disabled:pointer-events-auto data-disabled:cursor-not-allowed'
                              )}
                            >
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
                          </AgentTooltipRow>
                        );
                      }}
                    </ComboboxCollection>
                  </ComboboxGroup>
                )}
              </ComboboxList>
            </TooltipProvider>
          </ComboboxContent>
        </Combobox>
      </div>
    );
  }
);
