import { Download, Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useMemo, useState } from 'react';
import { AgentProviderId } from '@shared/agent-provider-registry';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { Button } from '@renderer/lib/ui/button';
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
} from '@renderer/lib/ui/combobox';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import {
  getInstallButtonState,
  isComboboxOptionDisabled,
  type AgentGroup,
  type AgentOption,
} from './agent-selector-options';
import { AgentTooltipRow } from './agent-tooltip-row';
import { useAgentAvailability } from './use-agent-availability';

interface AgentSelectorProps {
  value: AgentProviderId | null;
  onChange: (agent: AgentProviderId) => void;
  disabled?: boolean;
  className?: string;
  connectionId?: string;
  installable?: boolean;
}

export const AgentSelector: React.FC<AgentSelectorProps> = observer(
  ({ value, onChange, disabled = false, className = '', connectionId, installable = true }) => {
    const [open, setOpen] = useState(false);
    const { groups, installingAgents, installAgent } = useAgentAvailability({
      connectionId,
      value,
    });
    const allOptions = useMemo(() => groups.flatMap((group) => group.items), [groups]);

    const selectedConfig = value ? agentConfig[value] : null;
    const selectedOption = value ? allOptions.find((o) => o.value === value) : null;

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
              <span className="flex-1 truncate text-foreground-muted">No agent installed</span>
            )}
          </ComboboxTrigger>
          <ComboboxContent className="min-w-(--anchor-width)">
            <ComboboxInput showTrigger={false} placeholder="Search agents..." />
            <ComboboxList className="pb-0">
              {(group: AgentGroup) => (
                <ComboboxGroup key={group.value} items={group.items} className="py-1">
                  <ComboboxLabel>{group.label}</ComboboxLabel>
                  <ComboboxCollection>
                    {(item: AgentOption) => {
                      const config = agentConfig[item.agentId];
                      const installButton = getInstallButtonState(
                        item,
                        installable,
                        installingAgents
                      );
                      const showInstall = installButton.render;
                      return (
                        <AgentTooltipRow key={item.value} id={item.agentId}>
                          <ComboboxItem
                            value={item}
                            disabled={isComboboxOptionDisabled(item)}
                            className={cn(
                              'group/agent-row',
                              item.disabled &&
                                'data-disabled:pointer-events-auto data-disabled:cursor-not-allowed',
                              showInstall && 'data-disabled:opacity-100'
                            )}
                          >
                            {config && (
                              <AgentLogo
                                logo={config.logo}
                                alt={config.alt}
                                isSvg={config.isSvg}
                                invertInDark={config.invertInDark}
                                className={cn(
                                  'h-4 w-4 shrink-0 rounded-sm',
                                  showInstall && 'opacity-50'
                                )}
                              />
                            )}
                            <span
                              className={cn(
                                'min-w-0 flex-1 truncate',
                                showInstall && 'text-foreground-muted'
                              )}
                            >
                              {item.label}
                            </span>
                            {installButton.render ? (
                              <TooltipProvider delay={150}>
                                <Tooltip>
                                  <TooltipTrigger>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-xs"
                                      disabled={installButton.disabled}
                                      aria-label={installButton.label}
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        if (disabled) return;
                                        void installAgent(item.agentId);
                                      }}
                                      className="ml-auto size-6 cursor-pointer"
                                    >
                                      {installButton.installing ? (
                                        <Loader2
                                          className="h-3 w-3 animate-spin"
                                          aria-hidden="true"
                                        />
                                      ) : (
                                        <Download className="h-3 w-3" aria-hidden="true" />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="right" className="text-xs">
                                    {installButton.label}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : null}
                          </ComboboxItem>
                        </AgentTooltipRow>
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
  }
);
