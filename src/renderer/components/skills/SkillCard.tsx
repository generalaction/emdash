import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Pencil, Download } from 'lucide-react';
import type { CatalogSkill } from '@shared/skills/types';
import { useIsMonochrome } from '../../hooks/useIsMonochrome';

function formatInstalls(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

interface SkillCardProps {
  skill: CatalogSkill;
  onSelect: (skill: CatalogSkill) => void;
  onInstall: (skillId: string, source?: { owner: string; repo: string }) => void;
}

const SkillIcon: React.FC<{ skill: CatalogSkill }> = ({ skill }) => {
  const [imgError, setImgError] = useState(false);
  const letter = skill.displayName.charAt(0).toUpperCase();
  const isMonochrome = useIsMonochrome(skill.iconUrl);

  if (skill.iconUrl && !imgError) {
    return (
      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted/40">
        <img
          src={skill.iconUrl}
          alt=""
          className={`h-10 w-10 rounded-lg object-contain ${isMonochrome !== false ? 'dark:invert' : ''}`.trim()}
          onError={() => setImgError(true)}
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-muted/40 text-base font-semibold text-foreground/60 dark:text-white">
      {letter}
    </div>
  );
};

const SkillCard: React.FC<SkillCardProps> = ({ skill, onSelect, onInstall }) => {
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
      <SkillIcon skill={skill} />

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h3 className="truncate text-sm font-semibold">{skill.displayName}</h3>
          {skill.source === 'skills-sh' && skill.owner && (
            <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
              {skill.owner}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          {skill.description ? (
            <p className="line-clamp-1 text-xs text-muted-foreground">{skill.description}</p>
          ) : (
            <p className="line-clamp-1 text-xs text-muted-foreground/50">{skill.id}</p>
          )}
          {skill.installs != null && skill.installs > 0 && (
            <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground/60">
              <Download className="h-2.5 w-2.5" />
              {formatInstalls(skill.installs)}
            </span>
          )}
        </div>
      </div>

      {/* Action */}
      <div className="flex-shrink-0 self-center">
        {skill.installed ? (
          <Pencil className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const source =
                skill.source === 'skills-sh' && skill.owner && skill.repo
                  ? { owner: skill.owner, repo: skill.repo }
                  : undefined;
              onInstall(skill.id, source);
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
