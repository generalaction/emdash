import type { CatalogSkill } from './types';

export const SKILLSSH_BASE = 'https://skills.sh';

export interface SkillsshListSkill {
  name: string;
  skillId: string;
  source: string;
  installs: number;
  isOfficial?: boolean;
}

export interface SkillsshSearchResponse {
  skills: Array<{
    id: string;
    skillId: string;
    name: string;
    installs: number;
    source: string;
  }>;
}

export interface SkillsshDetailResponse {
  files: Array<{ path: string; contents: string }>;
  hash?: string | null;
}

export function parseSkillsshCatalogHtml(html: string): SkillsshListSkill[] {
  const catalogPattern = new RegExp(String.raw`(\[\{\\"source\\"[\s\S]*?\}\]),\\"totalSkills\\"`);
  const match = html.match(catalogPattern);
  if (!match) {
    throw new Error('Unable to parse skills.sh catalog');
  }

  return JSON.parse(match[1].replace(/\\"/g, '"')) as SkillsshListSkill[];
}

function titleCase(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function toSkillsshCatalogSkill(entry: SkillsshListSkill): CatalogSkill {
  const displayName = titleCase(entry.name || entry.skillId);
  return {
    id: entry.skillId,
    displayName,
    // Real descriptions get backfilled from SKILL.md frontmatter in the detail modal.
    description: '',
    source: 'skillssh',
    sourceUrl: `${SKILLSSH_BASE}/${entry.source}/${entry.skillId}`,
    brandColor: '#000000',
    frontmatter: { name: entry.skillId, description: '' },
    installed: false,
    installs: entry.installs,
    repoSlug: entry.source,
  };
}

export function mergeCatalogSkills(...skillGroups: CatalogSkill[][]): CatalogSkill[] {
  const seen = new Set<string>();
  const skills: CatalogSkill[] = [];

  for (const group of skillGroups) {
    for (const skill of group) {
      if (seen.has(skill.id)) continue;
      seen.add(skill.id);
      skills.push(skill);
    }
  }

  return skills;
}
