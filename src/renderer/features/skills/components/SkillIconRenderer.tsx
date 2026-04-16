import React, { useEffect, useState } from 'react';
import type { CatalogSkill } from '@shared/skills/types';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { resolveRemoteSkillIcon, resolveSkillIcon } from './skillIcons';

type SkillIconSize = 'sm' | 'md' | 'lg';

const sizeClasses: Record<SkillIconSize, { container: string; padding: string; text: string }> = {
  sm: { container: 'h-10 w-10', padding: 'p-2', text: 'text-sm' },
  md: { container: 'h-12 w-12', padding: 'p-2.5', text: 'text-base' },
  lg: { container: 'h-14 w-14', padding: 'p-3', text: 'text-lg' },
};

function processSvg(raw: string, fillColor: string): string | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(raw, 'image/svg+xml');
  const root = doc.documentElement;

  if (!root || root.tagName.toLowerCase() !== 'svg') {
    return null;
  }

  if (doc.querySelector('parsererror')) {
    return null;
  }

  // Remove risky elements/handlers before serializing.
  doc.querySelectorAll('script, foreignObject').forEach((el) => el.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      if (attr.name.toLowerCase().startsWith('on')) {
        el.removeAttribute(attr.name);
      }
    }
  });

  root.removeAttribute('width');
  root.removeAttribute('height');
  root.setAttribute('fill', fillColor);

  return new XMLSerializer().serializeToString(root);
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

  useEffect(() => {
    setIconUrlError(false);
    setRemoteIconError(false);
    setAvatarError(false);
  }, [skill.id, skill.iconUrl]);

  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'emdark';

  const { container, padding, text } = sizeClasses[size];
  const letter = skill.displayName.charAt(0).toUpperCase();

  // 1. Bundled SVG
  const svg = resolveSkillIcon(skill.id, skill.source);
  if (svg) {
    const processedSvg = processSvg(svg, isDark ? '#ffffff' : '#000000');
    if (processedSvg) {
      const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(processedSvg)}`;
      return (
        <div
          className={`flex ${container} shrink-0 items-center justify-center rounded-xl bg-muted/40 ${padding}`}
        >
          <img src={dataUri} alt="" className="h-full w-full object-contain" loading="lazy" />
        </div>
      );
    }
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
