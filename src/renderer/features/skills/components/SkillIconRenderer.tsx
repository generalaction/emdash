import React, { useState } from 'react';
import type { CatalogSkill } from '@shared/skills/types';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { resolveSkillIcon } from './skillIcons';

type SkillIconSize = 'sm' | 'md';

const sizeClasses: Record<SkillIconSize, { container: string; padding: string; text: string }> = {
  sm: { container: 'h-10 w-10', padding: 'p-2', text: 'text-sm' },
  md: { container: 'h-12 w-12', padding: 'p-2.5', text: 'text-base' },
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

const SkillIconRenderer: React.FC<SkillIconRendererProps> = ({ skill, size = 'sm' }) => {
  const [imgError, setImgError] = useState(false);
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

  // 2. Remote iconUrl
  if (skill.iconUrl && !imgError) {
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
          onError={() => setImgError(true)}
          loading="lazy"
        />
      </div>
    );
  }

  // 3. Letter fallback
  return (
    <div
      className={`flex ${container} shrink-0 items-center justify-center rounded-xl bg-muted/40 ${text} font-semibold text-foreground/60`}
    >
      {letter}
    </div>
  );
};

export default SkillIconRenderer;
