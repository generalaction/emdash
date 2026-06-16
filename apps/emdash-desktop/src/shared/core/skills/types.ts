export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  'allowed-tools'?: string;
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
  /** Skills.SH source repository, e.g. owner/repo */
  sourceRef?: string;
  /** Leaf skill id/name inside the source repository */
  catalogSkillId?: string;
  /** Exact SKILL.md-relative directory path from Skills.SH */
  skillShPath?: string;
  /** Public install count when provided by a catalog */
  installs?: number;
  /** Full SKILL.md content (loaded lazily) */
  skillMdContent?: string;
  /** Parsed frontmatter */
  frontmatter: SkillFrontmatter;
  /** Whether skill is installed locally */
  installed: boolean;
  /** Filesystem path if installed */
  localPath?: string;
}

export interface CatalogIndex {
  version: number;
  lastUpdated: string;
  skills: CatalogSkill[];
}
