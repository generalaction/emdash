import React, { useMemo, useState } from 'react';
import type { CatalogSkill } from '@shared/skills/types';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { resolveSkillIcon } from './skillIcons';

type SkillIconSize = 'sm' | 'md';

const sizeClasses: Record<SkillIconSize, { container: string; padding: string; text: string }> = {
  sm: { container: 'h-10 w-10', padding: 'p-2', text: 'text-sm' },
  md: { container: 'h-12 w-12', padding: 'p-2.5', text: 'text-base' },
};

const processedSvgCache = new Map<string, string>();

function processSvg(raw: string, fillColor: string): string {
  const cacheKey = `${fillColor}:${raw}`;
  const cached = processedSvgCache.get(cacheKey);
  if (cached) return cached;

  let svg = raw.replace(/\bwidth="[^"]*"/g, '').replace(/\bheight="[^"]*"/g, '');
  svg = svg.replace('<svg ', `<svg fill="${fillColor}" `);
  svg = svg.replace('<svg ', '<svg class="h-full w-full" ');
  processedSvgCache.set(cacheKey, svg);
  return svg;
}

interface SkillIconRendererProps {
  skill: CatalogSkill;
  size?: SkillIconSize;
}

function getGitHubAvatarUrl(skill: CatalogSkill): string | null {
  // repoSlug is "owner/repo" (e.g. "anthropics/skills"). Owner avatar comes from
  // https://github.com/{owner}.png — works for both users and orgs.
  const slug = skill.repoSlug;
  if (!slug) return null;
  const owner = slug.split('/')[0];
  if (!owner) return null;
  return `https://github.com/${owner}.png?size=96`;
}

const SkillIconRenderer: React.FC<SkillIconRendererProps> = React.memo(({ skill, size = 'sm' }) => {
  const [iconUrlError, setIconUrlError] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'emdark';

  const { container, padding, text } = sizeClasses[size];
  const letter = skill.displayName.charAt(0).toUpperCase();
  const svg = useMemo(() => resolveSkillIcon(skill.id, skill.source), [skill.id, skill.source]);
  const avatarUrl = useMemo(() => getGitHubAvatarUrl(skill), [skill.repoSlug]);

  // 1. Bundled SVG (canonical brand asset)
  if (svg) {
    const html = processSvg(svg, isDark ? '#ffffff' : '#000000');
    return (
      <div
        className={`flex ${container} shrink-0 items-center justify-center rounded-xl bg-muted/40 ${padding}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  // 2. Remote iconUrl (OpenAI catalog ships brand icons that we render monochrome)
  if (skill.iconUrl && !iconUrlError) {
    const filter = isDark ? 'brightness(0) invert(1)' : 'brightness(0)';
    return (
      <div
        className={`flex ${container} shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted/40 p-1.5`}
      >
        <img
          src={skill.iconUrl}
          alt=""
          className="h-full w-full rounded-lg object-contain"
          style={{ filter }}
          onError={() => setIconUrlError(true)}
          loading="lazy"
        />
      </div>
    );
  }

  // 3. GitHub avatar of the repo owner (skills.sh skills) — full color, no filter
  if (avatarUrl && !avatarError) {
    return (
      <div
        className={`flex ${container} shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted/40`}
      >
        <img
          src={avatarUrl}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setAvatarError(true)}
          loading="lazy"
        />
      </div>
    );
  }

  // 4. Letter fallback
  return (
    <div
      className={`flex ${container} shrink-0 items-center justify-center rounded-xl bg-muted/40 ${text} font-semibold text-foreground/60`}
    >
      {letter}
    </div>
  );
});

SkillIconRenderer.displayName = 'SkillIconRenderer';

export default SkillIconRenderer;
