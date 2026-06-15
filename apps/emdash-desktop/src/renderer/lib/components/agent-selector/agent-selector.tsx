import type { ComboboxRootChangeEventDetails } from '@base-ui/react/combobox';
import { ChevronDown } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useMemo, useState } from 'react';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
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
import { cn } from '@renderer/utils/utils';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import { AgentHoverCard, isEventInsideAgentHoverCard, useAgentHoverCard } from './agent-hover-card';
import {
  canInstallAgentOption,
  isComboboxOptionDisabled,
  type AgentGroup,
  type AgentOption,
} from './agent-selector-options';
import { useAgentAvailability } from './use-agent-availability';

interface AgentSelectorProps {
  value: AgentProviderId | null;
  onChange: (agent: AgentProviderId) => void;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  connectionId?: string;
  installable?: boolean;
  autoFocus?: boolean;
}

export const AgentSelector: React.FC<AgentSelectorProps> = observer(
  ({
    value,
    onChange,
    disabled = false,
    className = '',
    contentClassName,
    connectionId,
    installable = true,
    autoFocus = false,
  }) => {
    const [open, setOpen] = useState(false);
    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
    const hoverCard = useAgentHoverCard();
    const { groups } = useAgentAvailability({
      connectionId,
      value,
    });
    const allOptions = useMemo(() => groups.flatMap((group) => group.items), [groups]);

    const selectedOption = value ? allOptions.find((o) => o.value === value) : null;

    function handleOpenChange(next: boolean, eventDetails: ComboboxRootChangeEventDetails) {
      if (disabled) return;
      // Clicks/focus inside the hover card register as outside presses on the combobox;
      // they must not dismiss the agent list (which would unmount the card too).
      if (!next && hoverCard.open && isEventInsideAgentHoverCard(eventDetails.event, anchorEl)) {
        eventDetails.cancel();
        return;
      }
      if (!next) hoverCard.close();
      setOpen(next);
    }

    function handleValueChange(item: AgentOption | null) {
      if (!item || disabled || item.disabled) return;
      hoverCard.close();
      onChange(item.agentId);
      setOpen(false);
    }

    return (
      <Combobox
        items={groups}
        value={selectedOption ?? null}
        onValueChange={handleValueChange}
        open={open}
        onOpenChange={disabled ? undefined : handleOpenChange}
        isItemEqualToValue={(a: AgentOption, b: AgentOption) => a.value === b.value}
        filter={(item: AgentOption, query) =>
          item.label.toLowerCase().includes(query.toLowerCase())
        }
        autoHighlight
      >
        <ComboboxTrigger
          data-autofocus={autoFocus || undefined}
          disabled={disabled}
          className={cn(
            'flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-border bg-transparent px-2.5 py-1 text-sm outline-none',
            disabled && 'cursor-not-allowed opacity-60',
            className
          )}
        >
          {value ? (
            <>
              <AgentIcon id={value} size={16} className="rounded-sm" />
              <span className="flex-1 truncate text-left">{selectedOption?.label ?? value}</span>
            </>
          ) : (
            <span className="flex-1 truncate text-foreground-muted">No agent installed</span>
          )}
          <ChevronDown className="size-3.5 shrink-0 text-foreground-muted" />
        </ComboboxTrigger>
        <ComboboxContent
          ref={setAnchorEl}
          className={cn('min-w-(--anchor-width)', contentClassName)}
        >
          <ComboboxInput showTrigger={false} placeholder="Search agents..." />
          <ComboboxList className="pb-0">
            {(group: AgentGroup) => (
              <ComboboxGroup key={group.value} items={group.items} className="py-1">
                <ComboboxLabel>{group.label}</ComboboxLabel>
                <ComboboxCollection>
                  {(item: AgentOption) => {
                    const showInstall = canInstallAgentOption(item, installable);
                    return (
                      <ComboboxItem
                        key={item.value}
                        value={item}
                        disabled={isComboboxOptionDisabled(item)}
                        className={cn(
                          'group/agent-row',
                          item.disabled &&
                            'data-disabled:pointer-events-auto data-disabled:cursor-not-allowed',
                          showInstall && 'data-disabled:opacity-100'
                        )}
                        {...hoverCard.getRowHoverProps(item.agentId)}
                      >
                        <AgentIcon
                          id={item.agentId}
                          size={16}
                          className={cn('rounded-sm', showInstall && 'opacity-50')}
                        />
                        <span
                          className={cn(
                            'min-w-0 flex-1 truncate',
                            showInstall && 'text-foreground-muted'
                          )}
                        >
                          {item.label}
                        </span>
                      </ComboboxItem>
                    );
                  }}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        </ComboboxContent>
        <AgentHoverCard anchor={anchorEl} controller={hoverCard} connectionId={connectionId} />
      </Combobox>
    );
  }
);
