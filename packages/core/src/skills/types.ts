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

export interface CatalogSkill {
  id: string;
  installId?: string;
  displayName: string;
  description: string;
  source: 'openai' | 'anthropic' | 'skillssh' | 'local';
  sourceUrl?: string;
  iconUrl?: string;
  brandColor?: string;
  defaultPrompt?: string;
  sourceRef?: string;
  catalogSkillId?: string;
  skillShPath?: string;
  installs?: number;
  skillMdContent?: string;
  frontmatter: SkillFrontmatter;
  installed: boolean;
  managedByEmdash?: boolean;
  localPath?: string;
  locations?: SkillLocation[];
  targets?: SkillTargetSelection;
}

export interface CatalogIndex {
  version: number;
  lastUpdated: string;
  skills: CatalogSkill[];
}
