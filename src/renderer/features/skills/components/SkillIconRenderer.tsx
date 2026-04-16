import React, { useState } from 'react';
import type { CatalogSkill } from '@shared/skills/types';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { resolveRemoteSkillIcon, resolveSkillIcon } from './skillIcons';

type SkillIconSize = 'sm' | 'md' | 'lg';

const sizeClasses: Record<SkillIconSize, { container: string; padding: string; text: string }> = {
  sm: { container: 'h-10 w-10', padding: 'p-2', text: 'text-sm' },
  md: { container: 'h-12 w-12', padding: 'p-2.5', text: 'text-base' },
  lg: { container: 'h-14 w-14', padding: 'p-3', text: 'text-lg' },
};

function processSvg(raw: string, fillColor: string): string {
  let svg = raw.replace(/\bwidth="[^"]*"/g, '').replace(/\bheight="[^"]*"/g, '');
  svg = svg.replace('<svg ', `<svg fill="${fillColor}" `);
  return svg.replace('<svg ', '<svg class="h-full w-full" ');
}

interface SkillIconRendererProps {
  skill: CatalogSkill;
  size?: SkillIconSize;
}

function isGithubAvatar(url: string): boolean {
  return /^https?:\/\/(www\.)?github\.com\/[^/]+\.png/.test(url);
}

const SkillIconRenderer: React.FC<SkillIconRendererProps> = ({ skill, size = 'sm' }) => {
  const [iconUrlError, setIconUrlError] = useState(false);
  const [remoteIconError, setRemoteIconError] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'emdark';

  const { container, padding, text } = sizeClasses[size];
  const letter = skill.displayName.charAt(0).toUpperCase();

  // 1. Bundled SVG
  const svg = resolveSkillIcon(skill.id, skill.source);
  if (svg) {
    const html = processSvg(svg, isDark ? '#ffffff' : '#000000');
    return (
      <div
        className={`flex ${container} shrink-0 items-center justify-center rounded-xl bg-muted/40 ${padding}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  // 2. Simple-Icons CDN for known technologies (skills.sh-style brand mark)
  const remoteIcon = resolveRemoteSkillIcon(skill.id, isDark ? 'ffffff' : '000000', skill.owner);
  if (remoteIcon && !remoteIconError) {
    return (
      <div
        className={`flex ${container} shrink-0 items-center justify-center rounded-xl bg-muted/40 ${padding}`}
      >
        <img
          src={remoteIcon}
          alt=""
          className="h-full w-full object-contain"
          onError={() => setRemoteIconError(true)}
          loading="lazy"
        />
      </div>
    );
  }

  // 3. Remote iconUrl. Preserve colors for GitHub avatars (skills.sh owner pics).
  if (skill.iconUrl && !iconUrlError) {
    const isAvatar = isGithubAvatar(skill.iconUrl);
    const filter = isAvatar ? undefined : isDark ? 'brightness(0) invert(1)' : 'brightness(0)';
    return (
      <div
        className={`flex ${container} shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted/40 p-1.5`}
      >
        <img
          src={skill.iconUrl}
          alt=""
          className="h-full w-full rounded-lg object-contain"
          style={filter ? { filter } : undefined}
          onError={() => setIconUrlError(true)}
          loading="lazy"
        />
      </div>
    );
  }

  // 4. Owner GitHub avatar fallback for skills-sh
  if (skill.source === 'skills-sh' && skill.owner && !avatarError) {
    const avatarUrl = `https://github.com/${skill.owner}.png?size=80`;
    if (skill.iconUrl !== avatarUrl) {
      return (
        <div
          className={`flex ${container} shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted/40 p-1.5`}
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

  // 5. Letter fallback
  return (
    <div
      className={`flex ${container} shrink-0 items-center justify-center rounded-xl bg-muted/40 ${text} font-semibold text-foreground/60`}
    >
      {letter}
    </div>
  );
};

export default SkillIconRenderer;
