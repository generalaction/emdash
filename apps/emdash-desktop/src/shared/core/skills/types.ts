export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  'allowed-tools'?: string;
}

export type SkillTargetSelection = { mode: 'all' } | { mode: 'providers'; providerIds: string[] };

export interface SkillLocation {
  relativeDir: string;
  kind: 'canonical' | 'provider' | 'shared';
  providerIds: string[];
  ownership: 'emdash' | 'external';
}

export interface SkillProvider {
  id: string;
  name: string;
  installed: boolean;
}

export interface CatalogSkill {
  /** Skill directory name */
  id: string;
  /** Local install directory name when it differs from the catalog id */
  installId?: string;
  /** Human-readable display name */
  displayName: string;
  /** Short description */
  description: string;
  /** Catalog source */
  source: 'openai' | 'anthropic' | 'skillssh' | 'local';
  /** GitHub URL */
  sourceUrl?: string;
  /** Icon URL (OpenAI skills have SVG/PNG) */
  iconUrl?: string;
  /** Hex color */
  brandColor?: string;
  /** Example prompt */
  defaultPrompt?: string;
  /** Skills.sh source repository, e.g. owner/repo */
  sourceRef?: string;
  /** Leaf skill id/name inside the source repository */
  catalogSkillId?: string;
  /** Exact SKILL.md-relative directory path from Skills.sh */
  skillShPath?: string;
  /** Public install count when provided by a catalog */
  installs?: number;
  /** Full SKILL.md content (loaded lazily) */
  skillMdContent?: string;
  /** Parsed frontmatter */
  frontmatter: SkillFrontmatter;
  /** Whether skill is installed locally */
  installed: boolean;
  /** Whether Emdash owns the canonical skill and may uninstall it */
  managedByEmdash?: boolean;
  /** Filesystem path if installed */
  localPath?: string;
  /** Filesystem locations where the skill was discovered */
  locations?: SkillLocation[];
  /** Desired sync targets for Emdash-managed skills */
  targets?: SkillTargetSelection;
}

export interface CatalogIndex {
  version: number;
  lastUpdated: string;
  skills: CatalogSkill[];
}
