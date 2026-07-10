import type { AgentProviderId } from '@emdash/plugins/agents';
import { Plus, Trash2 } from 'lucide-react';
import React from 'react';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { CardGridItem } from '@renderer/lib/components/card-grid';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import type { CatalogSkill, SkillProvider } from '@shared/core/skills/types';
import { SkillIconRenderer } from './SkillIconRenderer';

interface SkillCardProps {
  skill: CatalogSkill;
  providers: SkillProvider[];
  isInstalled: boolean;
  onUninstall: (skillId: string) => void;
  onClick: () => void;
}

export const SkillCard: React.FC<SkillCardProps> = ({
  skill,
  providers,
  isInstalled,
  onUninstall,
  onClick,
}) => {
  const providerIds = [
    ...new Set(skill.locations?.flatMap((location) => location.providerIds) ?? []),
  ];
  const providerNames = new Map(providers.map((provider) => [provider.id, provider.name]));

  return (
    <CardGridItem
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      className="relative"
    >
      <SkillIconRenderer skill={skill} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h3 className="text-md truncate">{skill.displayName}</h3>
        <p className="mt-0.5 line-clamp-1 text-xs text-foreground-muted">{skill.description}</p>
        {providerIds.length > 0 && (
          <div
            className="mt-1 flex items-center -space-x-1"
            title={providerIds.map((id) => providerNames.get(id) ?? id).join(', ')}
            aria-label={`Found in ${providerIds.map((id) => providerNames.get(id) ?? id).join(', ')}`}
          >
            {providerIds.slice(0, 4).map((providerId) => (
              <AgentIcon
                key={providerId}
                id={providerId as AgentProviderId}
                size={15}
                className="rounded-sm ring-1 ring-background"
              />
            ))}
          </div>
        )}
      </div>
      {(!isInstalled || skill.managedByEmdash) && (
        <div className="absolute top-1/2 right-2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100">
          <Tooltip>
            <TooltipTrigger>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  if (isInstalled) {
                    onUninstall(skill.installId ?? skill.id);
                  } else {
                    onClick();
                  }
                }}
              >
                {isInstalled ? <Trash2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isInstalled ? 'Uninstall' : 'Install'}</TooltipContent>
          </Tooltip>
        </div>
      )}
    </CardGridItem>
  );
};
