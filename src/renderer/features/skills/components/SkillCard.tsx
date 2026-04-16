import { motion } from 'framer-motion';
import { Check, Download, Plus } from 'lucide-react';
import React from 'react';
import type { CatalogSkill } from '@shared/skills/types';
import SkillIconRenderer from './SkillIconRenderer';

interface SkillCardProps {
  skill: CatalogSkill;
  onSelect: (skill: CatalogSkill) => void;
  onInstall: (skillId: string, source?: { owner: string; repo: string }) => void;
}

function formatInstalls(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
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
      <SkillIconRenderer skill={skill} size="md" />

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h3 className="truncate text-sm font-semibold">{skill.displayName}</h3>
          {skill.installed && (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground"
              title="Installed"
            >
              <Check className="h-2.5 w-2.5" />
              Installed
            </span>
          )}
        </div>
        {skill.description && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{skill.description}</p>
        )}
        {typeof skill.installs === 'number' && skill.installs > 0 && (
          <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground/80">
            <Download className="h-2.5 w-2.5" />
            <span className="tabular-nums">{formatInstalls(skill.installs)}</span>
            {skill.owner && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="truncate">{skill.owner}</span>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 self-center">
        {!skill.installed && (
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
