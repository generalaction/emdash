import { Plus, Trash2 } from 'lucide-react';
import React from 'react';
import type { CatalogSkill } from '@shared/skills/types';
import { CardGridItem } from '@renderer/lib/components/card-grid';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { SkillIconRenderer } from './SkillIconRenderer';

interface SkillCardProps {
  skill: CatalogSkill;
  isInstalled: boolean;
  onInstall: (skillId: string) => void;
  onUninstall: (skillId: string) => void;
  onClick: () => void;
}

export const SkillCard: React.FC<SkillCardProps> = ({
  skill,
  isInstalled,
  onInstall,
  onUninstall,
  onClick,
}) => {
  return (
    <CardGridItem role="button" tabIndex={0} onClick={onClick} className="relative">
      <SkillIconRenderer skill={skill} />
      <div className="min-w-0 flex-1 flex flex-col gap-0.5">
        <h3 className="truncate text-md">{skill.displayName}</h3>
        <p className="mt-0.5 line-clamp-1 text-xs text-foreground-muted">{skill.description}</p>
      </div>
      <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100">
        <Tooltip>
          <TooltipTrigger>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                if (isInstalled) {
                  onUninstall(skill.id);
                } else {
                  onInstall(skill.id);
                }
              }}
            >
              {isInstalled ? <Trash2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isInstalled ? 'Uninstall' : 'Install'}</TooltipContent>
        </Tooltip>
      </div>
    </CardGridItem>
  );
};


