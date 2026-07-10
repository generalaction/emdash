import type { AgentProviderId } from '@emdash/plugins/agents';
import React from 'react';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { Button } from '@renderer/lib/ui/button';
import { cn } from '@renderer/utils/utils';
import type { SkillProvider, SkillTargetSelection } from '@shared/core/skills/types';

interface SkillProviderSelectProps {
  providers: SkillProvider[];
  targets: SkillTargetSelection;
  disabled?: boolean;
  onChange: (targets: SkillTargetSelection) => void;
}

export const SkillProviderSelect: React.FC<SkillProviderSelectProps> = ({
  providers,
  targets,
  disabled,
  onChange,
}) => {
  const installedProviders = providers.filter((provider) => provider.installed);
  const selected = new Set(
    targets.mode === 'all' ? installedProviders.map((provider) => provider.id) : targets.providerIds
  );

  const toggleProvider = (providerId: string) => {
    const next = new Set(selected);
    if (next.has(providerId)) next.delete(providerId);
    else next.add(providerId);
    onChange({ mode: 'providers', providerIds: [...next] });
  };

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs font-medium">Sync to agents</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-pressed={targets.mode === 'all'}
          onClick={() => onChange({ mode: 'all' })}
          className={cn(
            targets.mode === 'all' && 'border-primary bg-primary/10 ring-1 ring-primary/30'
          )}
        >
          All agents
        </Button>
        {installedProviders.map((provider) => {
          const isSelected = selected.has(provider.id);
          return (
            <Button
              key={provider.id}
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              aria-pressed={isSelected}
              onClick={() => toggleProvider(provider.id)}
              className={cn(
                'gap-1.5',
                isSelected && 'border-primary bg-primary/10 ring-1 ring-primary/30'
              )}
            >
              <AgentIcon id={provider.id as AgentProviderId} size={16} className="rounded-sm" />
              {provider.name}
            </Button>
          );
        })}
      </div>
    </div>
  );
};
