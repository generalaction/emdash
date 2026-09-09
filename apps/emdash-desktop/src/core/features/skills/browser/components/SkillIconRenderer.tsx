import type { CatalogSkill } from '@emdash/core/primitives/skills/api';
import React, { useState } from 'react';
import { useTheme } from '@core/primitives/theme/browser';
import { resolveSkillIcon } from './skillIcons';
import { skillIconAssetAdapter } from './skill-icon-asset.adapter.css';

function processSvg(raw: string, fillColor: string): string {
  let svg = raw.replace(/\bwidth="[^"]*"/g, '').replace(/\bheight="[^"]*"/g, '');
  svg = svg.replace('<svg ', `<svg fill="${fillColor}" `);
  return svg;
}

interface SkillIconRendererProps {
  skill: CatalogSkill;
}

export const SkillIconRenderer: React.FC<SkillIconRendererProps> = ({ skill }) => {
  const [imgError, setImgError] = useState(false);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme.colorScheme.polarity === 'dark';

  const letter = skill.displayName.charAt(0).toUpperCase();

  const renderImageIcon = () => {
    if (!skill.iconUrl || imgError) return null;
    const filter =
      skill.source === 'skillssh'
        ? undefined
        : isDark
          ? 'brightness(0) invert(1)'
          : 'brightness(0)';
    return (
      <span className={skillIconAssetAdapter} data-foreign-adapter="skill-icon-asset">
        <img
          src={skill.iconUrl}
          alt=""
          style={{ filter }}
          onError={() => setImgError(true)}
          loading="lazy"
        />
      </span>
    );
  };

  const renderIcon = () => {
    if (skill.source === 'skillssh') {
      const imageIcon = renderImageIcon();
      if (imageIcon) return imageIcon;
    }

    const svg = resolveSkillIcon(skill.catalogSkillId ?? skill.id, skill.source);
    if (svg) {
      const html = processSvg(svg, isDark ? '#ffffff' : '#000000');
      return (
        <span
          className={skillIconAssetAdapter}
          data-foreign-adapter="skill-icon-asset"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    }

    return renderImageIcon() ?? letter;
  };

  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-background-2 p-2 font-semibold text-foreground/60 transition-colors group-hover:bg-background-3">
      {renderIcon()}
    </div>
  );
};
