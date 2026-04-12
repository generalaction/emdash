import React, { useState } from 'react';
import type { CatalogSkill } from '@shared/skills/types';
import { useIsMonochrome } from '../../hooks/useIsMonochrome';
import { resolveSkillIcon } from '../../lib/skillIcons';
import { useTheme } from '../../hooks/useTheme';

type SkillIconSize = 'sm' | 'md';

const sizeClasses: Record<SkillIconSize, { container: string; padding: string; text: string }> = {
  sm: { container: 'h-10 w-10', padding: 'p-2', text: 'text-sm' },
  md: { container: 'h-12 w-12', padding: 'p-2.5', text: 'text-base' },
};

function processSvg(raw: string, fillColor: string, preserveColors: boolean): string {
  let svg = raw.replace(/\bwidth="[^"]*"/g, '').replace(/\bheight="[^"]*"/g, '');
  if (!preserveColors) {
    svg = svg.replace('<svg ', `<svg fill="${fillColor}" `);
  }
  return svg.replace('<svg ', '<svg class="h-full w-full" ');
}

interface SkillIconRendererProps {
  skill: CatalogSkill;
  size?: SkillIconSize;
}

const SkillIconRenderer: React.FC<SkillIconRendererProps> = ({ skill, size = 'sm' }) => {
  const [iconUrlError, setIconUrlError] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme !== 'light';

  const iconDef = resolveSkillIcon(skill.id, skill.source);
  const remoteUrl = !iconDef ? skill.iconUrl : undefined;
  const isMonochrome = useIsMonochrome(remoteUrl);

  const { container, padding, text } = sizeClasses[size];
  const letter = skill.displayName.charAt(0).toUpperCase();

  // 1. Bundled SVG icon
  if (iconDef) {
    const fillColor = isDark ? '#ffffff' : `#${iconDef.color}`;
    const html = processSvg(iconDef.data, fillColor, iconDef.preserveColors ?? false);
    return (
      <div
        className={`flex ${container} flex-shrink-0 items-center justify-center rounded-xl bg-muted/40 ${padding}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  // 2. Remote iconUrl
  if (skill.iconUrl && !iconUrlError) {
    const isAvatar = skill.iconUrl.includes('github.com/') && skill.iconUrl.includes('.png');
    const invertClass = !isAvatar && isMonochrome !== false ? 'dark:invert' : '';
    return (
      <div
        className={`flex ${container} flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted/40 p-1.5`}
      >
        <img
          src={skill.iconUrl}
          alt=""
          className={`h-full w-full rounded-lg object-contain ${invertClass}`.trim()}
          onError={() => setIconUrlError(true)}
          loading="lazy"
        />
      </div>
    );
  }

  // 3. Owner GitHub avatar fallback
  if (skill.source === 'skills-sh' && skill.owner && !avatarError) {
    const avatarUrl = `https://github.com/${skill.owner}.png?size=80`;
    if (!(skill.iconUrl === avatarUrl && iconUrlError)) {
      return (
        <div
          className={`flex ${container} flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted/40 p-1.5`}
        >
          <img
            src={avatarUrl}
            alt=""
            className="h-full w-full rounded-lg object-cover"
            onError={() => setAvatarError(true)}
            loading="lazy"
          />
        </div>
      );
    }
  }

  // 4. Letter fallback
  return (
    <div
      className={`flex ${container} flex-shrink-0 items-center justify-center rounded-xl bg-muted/40 ${text} font-semibold text-foreground/60`}
    >
      {letter}
    </div>
  );
};

export default SkillIconRenderer;
