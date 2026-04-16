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
  source: 'openai' | 'anthropic' | 'skills-sh' | 'local';
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
  /** GitHub owner for skills-sh skills (e.g. "vercel-labs") */
  owner?: string;
  /** GitHub repo for skills-sh skills (e.g. "agent-skills") */
  repo?: string;
  /** Total install count from skills.sh */
  installs?: number;
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
