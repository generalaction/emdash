import type { AgentProviderId } from '@emdash/plugins/agents';
import { Plus } from 'lucide-react';
import React from 'react';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { buttonVariants } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';
import type { SkillProvider, SkillTargetSelection } from '@shared/core/skills/types';

interface SkillSyncPopoverProps {
  providers: SkillProvider[];
  targets: SkillTargetSelection;
  disabled?: boolean;
  onChange: (targets: SkillTargetSelection) => void;
}

export const SkillSyncPopover: React.FC<SkillSyncPopoverProps> = ({
  providers,
  targets,
  disabled,
  onChange,
}) => {
  const installedProviders = providers.filter((provider) => provider.installed);
  const isAll = targets.mode === 'all';
  const selected = new Set(
    isAll ? installedProviders.map((provider) => provider.id) : targets.providerIds
  );

  const toggleProvider = (providerId: string) => {
    const next = new Set(selected);
    if (next.has(providerId)) next.delete(providerId);
    else next.add(providerId);
    onChange({ mode: 'providers', providerIds: [...next] });
  };

  const triggerLabel = isAll
    ? 'All agents'
    : selected.size > 0
      ? `${selected.size} agent${selected.size === 1 ? '' : 's'}`
      : 'Add to agent';

  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5')}
      >
        <Plus className="h-3.5 w-3.5" />
        {triggerLabel}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-0 p-1">
        <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-background-2">
          <Checkbox
            checked={isAll}
            disabled={disabled}
            onCheckedChange={(checked) => checked && onChange({ mode: 'all' })}
          />
          <span className="font-medium">All agents</span>
        </label>
        <div className="my-1 h-px bg-border" />
        <div className="max-h-64 overflow-y-auto">
          {installedProviders.map((provider) => (
            <label
              key={provider.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-background-2"
            >
              <Checkbox
                checked={selected.has(provider.id)}
                disabled={disabled}
                onCheckedChange={() => toggleProvider(provider.id)}
              />
              <AgentIcon id={provider.id as AgentProviderId} size={16} className="rounded-sm" />
              <span className="truncate">{provider.name}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
