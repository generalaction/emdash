import { motion } from 'framer-motion';
import { Download, Pencil, Plus } from 'lucide-react';
import React from 'react';
import type { CatalogSkill } from '@shared/skills/types';
import SkillIconRenderer from './SkillIconRenderer';

interface SkillCardProps {
  skill: CatalogSkill;
  onSelect: (skill: CatalogSkill) => void;
  onInstall: (skillId: string, source?: { owner: string; repo: string }) => void;
}

function formatInstalls(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

const SkillCard: React.FC<SkillCardProps> = ({ skill, onSelect, onInstall }) => {
  const installSource =
    skill.source === 'skills-sh' && skill.owner && skill.repo
      ? { owner: skill.owner, repo: skill.repo }
      : undefined;

  return (
    <motion.div
      role="button"
      tabIndex={0}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.1, ease: 'easeInOut' }}
      onClick={() => onSelect(skill)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(skill);
        }
      }}
      className="group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-muted/20 p-4 text-left text-card-foreground shadow-sm transition-all hover:bg-muted/40 hover:shadow-md"
    >
      <SkillIconRenderer skill={skill} />

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h3 className="truncate text-sm font-semibold">{skill.displayName}</h3>
          {typeof skill.installs === 'number' && skill.installs > 0 && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
              <Download className="h-2.5 w-2.5" />
              {formatInstalls(skill.installs)}
            </span>
          )}
        </div>
        {skill.description && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{skill.description}</p>
        )}
      </div>

      {/* Action */}
      <div className="shrink-0 self-center">
        {skill.installed ? (
          <Pencil className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onInstall(skill.id, installSource);
            }}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={`Install ${skill.displayName}`}
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>
    </motion.div>
  );
};

export default SkillCard;
