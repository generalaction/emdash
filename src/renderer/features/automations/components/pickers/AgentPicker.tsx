import { ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import AgentLogo from '@renderer/lib/components/agent-logo';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxGroup,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@renderer/lib/ui/combobox';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { AGENT_PROVIDER_IDS, type AgentProviderId } from '@shared/agent-provider-registry';
import { PILL_TRIGGER_CLASS } from './pill-trigger';

interface PillItem<V> {
  value: V;
  label: string;
}

interface AgentPickerProps {
  value: AgentProviderId;
  onChange: (next: AgentProviderId) => void;
}

export function AgentPicker({ value, onChange }: AgentPickerProps) {
  const items = useMemo<PillItem<AgentProviderId>[]>(
    () =>
      AGENT_PROVIDER_IDS.filter((id) => agentConfig[id]).map((id) => ({
        value: id,
        label: agentConfig[id]?.name ?? id,
      })),
    []
  );
  const selectedConfig = agentConfig[value];
  const [open, setOpen] = useState(false);
  const selected = items.find((item) => item.value === value) ?? null;
  const label = selected?.label ?? '';

  return (
    <Combobox
      items={[{ value: 'agents', items }]}
      value={selected}
      onValueChange={(item: PillItem<AgentProviderId> | null) => {
        if (item) onChange(item.value);
        setOpen(false);
      }}
      open={open}
      onOpenChange={setOpen}
      isItemEqualToValue={(a: PillItem<AgentProviderId>, b: PillItem<AgentProviderId>) =>
        a?.value === b?.value
      }
      filter={(item: PillItem<AgentProviderId>, query: string) =>
        item.label.toLowerCase().includes(query.toLowerCase())
      }
      autoHighlight
    >
      <ComboboxTrigger className={cn(PILL_TRIGGER_CLASS, 'w-full justify-between')}>
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {selectedConfig ? (
            <AgentLogo
              logo={selectedConfig.logo}
              alt={selectedConfig.alt}
              isSvg={selectedConfig.isSvg}
              invertInDark={selectedConfig.invertInDark}
              className="size-3.5 shrink-0 rounded-sm"
            />
          ) : null}
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown className="size-3 shrink-0 text-foreground-passive" />
      </ComboboxTrigger>
      <ComboboxContent className="w-auto min-w-(--anchor-width)">
        <ComboboxList className="py-1">
          {(group: { value: string; items: PillItem<AgentProviderId>[] }) => (
            <ComboboxGroup key={group.value} items={group.items}>
              <ComboboxCollection>
                {(item: PillItem<AgentProviderId>) => {
                  const config = agentConfig[item.value];
                  return (
                    <ComboboxItem
                      key={String(item.value)}
                      value={item}
                      className="gap-1.5 py-1.5 pr-7 pl-2 text-xs"
                    >
                      {config ? (
                        <AgentLogo
                          logo={config.logo}
                          alt={config.alt}
                          isSvg={config.isSvg}
                          invertInDark={config.invertInDark}
                          className="size-4 shrink-0 rounded-sm"
                        />
                      ) : null}
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    </ComboboxItem>
                  );
                }}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
