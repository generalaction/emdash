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
  /** Human-readable display name */
  displayName: string;
  /** Short description */
  description: string;
  /** Catalog source */
  source: 'openai' | 'anthropic' | 'local';
  /** GitHub URL */
  sourceUrl?: string;
  /** Icon URL (OpenAI skills have SVG/PNG) */
  iconUrl?: string;
  /** Hex color */
  brandColor?: string;
  /** Example prompt */
  defaultPrompt?: string;
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

export interface DetectedAgent {
  id: string;
  name: string;
  configDir: string;
  installed: boolean;
}
