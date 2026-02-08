import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Pencil } from 'lucide-react';
import type { CatalogSkill } from '@shared/skills/types';

interface SkillCardProps {
  skill: CatalogSkill;
  onSelect: (skill: CatalogSkill) => void;
  onInstall: (skillId: string) => void;
}

const SkillIcon: React.FC<{ skill: CatalogSkill }> = ({ skill }) => {
  const [imgError, setImgError] = useState(false);
  const letter = skill.displayName.charAt(0).toUpperCase();

  if (skill.iconUrl && !imgError) {
    return (
      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted/40">
        <img
          src={skill.iconUrl}
          alt=""
          className="h-10 w-10 rounded-lg object-contain"
          onError={() => setImgError(true)}
          loading="lazy"
        />
      </div>
    );
  }

  const bgColor = skill.brandColor || (skill.source === 'openai' ? '#10a37f' : '#d4a574');
  return (
    <div
      className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-base font-semibold text-white"
      style={{ backgroundColor: bgColor }}
    >
      {letter}
    </div>
  );
};

const SkillCard: React.FC<SkillCardProps> = ({ skill, onSelect, onInstall }) => {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.1, ease: 'easeInOut' }}
      onClick={() => onSelect(skill)}
      className="group flex w-full items-center gap-3 rounded-lg border border-border bg-muted/20 p-4 text-left text-card-foreground shadow-sm transition-all hover:bg-muted/40 hover:shadow-md"
    >
      <SkillIcon skill={skill} />

      {/* Content */}
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold">{skill.displayName}</h3>
        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{skill.description}</p>
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
              onInstall(skill.id);
            }}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={`Install ${skill.displayName}`}
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>
    </motion.button>
  );
};

export default SkillCard;
