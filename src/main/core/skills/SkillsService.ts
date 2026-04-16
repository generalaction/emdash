import * as fs from 'node:fs';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import { agentTargets, skillScanPaths } from '@shared/skills/agentTargets';
import type { CatalogIndex, CatalogSkill, DetectedAgent } from '@shared/skills/types';
import { generateSkillMd, isValidSkillName, parseFrontmatter } from '@shared/skills/validation';
import { log } from '@main/lib/logger';
import bundledCatalog from './bundled-catalog.json';

const SKILLS_ROOT = path.join(os.homedir(), '.agentskills');
const EMDASH_META = path.join(SKILLS_ROOT, '.emdash');
const CATALOG_INDEX_PATH = path.join(EMDASH_META, 'catalog-index.json');

const MAX_REDIRECTS = 5;

const SKILLS_SH_SEARCH_URL = 'https://skills.sh/api/search';
const SKILLS_SH_BASE_URL = 'https://skills.sh';
const SKILLS_SH_BROWSE_TTL_MS = 5 * 60 * 1000;

export type SkillsShBrowseKind = 'all-time' | 'trending' | 'hot';

const BROWSE_PATHS: Record<SkillsShBrowseKind, string> = {
  'all-time': '/',
  trending: '/trending',
  hot: '/hot',
};

/** Convert a kebab-case name to Title Case (e.g. "code-review" → "Code Review"). */
function titleCase(kebab: string): string {
  return kebab
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Deduplicate skills by id — first occurrence wins. */
function deduplicateById(skills: CatalogSkill[]): CatalogSkill[] {
  const seen = new Set<string>();
  return skills.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}

interface SkillsShSearchResult {
  query: string;
  searchType: string;
  skills: Array<{
    id: string;
    skillId: string;
    name: string;
    installs: number;
    source: string;
  }>;
  count: number;
  duration_ms: number;
}

function httpsGet(
  url: string,
  redirectCount = 0,
  headers: Record<string, string> = {
    'User-Agent': 'emdash-skills',
    Accept: 'application/vnd.github.v3+json',
  }
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (redirectCount >= MAX_REDIRECTS) {
      reject(new Error(`Too many redirects (>${MAX_REDIRECTS}) for ${url}`));
      return;
    }
    const req = https.get(url, { headers }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const location = res.headers.location;
        if (location) {
          const resolved = new URL(location, url).href;
          httpsGet(resolved, redirectCount + 1, headers).then(resolve, reject);
          return;
        }
      }
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error('Request timed out'));
    });
  });
}

export class SkillsService {
  private static readonly CATALOG_VERSION = 3;
  private catalogCache: CatalogIndex | null = null;
  private browseCache: Map<SkillsShBrowseKind, { at: number; skills: CatalogSkill[] }> = new Map();

  async initialize(): Promise<void> {
    await fs.promises.mkdir(EMDASH_META, { recursive: true });
  }

  async getCatalogIndex(): Promise<CatalogIndex> {
    if (this.catalogCache) {
      return this.mergeInstalledState(this.catalogCache);
    }

    // Try disk cache — only use if its version matches current
    try {
      const data = await fs.promises.readFile(CATALOG_INDEX_PATH, 'utf-8');
      const diskCache = JSON.parse(data) as CatalogIndex;
      if (diskCache.version >= SkillsService.CATALOG_VERSION) {
        this.catalogCache = diskCache;
        return this.mergeInstalledState(this.catalogCache);
      }
      // Stale disk cache — fall through to bundled
    } catch {
      // No disk cache — fall back to bundled catalog
    }

    const bundled = this.loadBundledCatalog();
    this.catalogCache = bundled;
    return this.mergeInstalledState(bundled);
  }

  async refreshCatalog(): Promise<CatalogIndex> {
    try {
      const [openaiSkills, anthropicSkills] = await Promise.allSettled([
        this.fetchOpenAICatalog(),
        this.fetchAnthropicCatalog(),
      ]);

      const allSkills: CatalogSkill[] = [];
      if (openaiSkills.status === 'fulfilled') {
        allSkills.push(...openaiSkills.value);
      }
      if (anthropicSkills.status === 'fulfilled') {
        allSkills.push(...anthropicSkills.value);
      }
      allSkills.push({
        id: 'mmx-cli',
        displayName: 'MiniMax CLI',
        description: 'Generate text, images, video, speech, and music via MiniMax AI platform',
        source: 'skills-sh',
        iconUrl: 'https://github.com/MiniMax-AI.png?size=80',
        brandColor: '#171717',
        defaultPrompt: 'Use MiniMax to generate content (text, image, video, speech, or music).',
        frontmatter: {
          name: 'mmx-cli',
          description: 'Generate text, images, video, speech, and music via MiniMax AI platform',
        },
        installed: false,
        owner: 'MiniMax-AI',
        repo: 'cli',
      });

      const skills = deduplicateById(allSkills);

      // If both failed, fall back to bundled
      if (skills.length === 0) {
        log.warn('Failed to fetch any remote catalogs, using bundled');
        return this.getCatalogIndex();
      }

      const catalog: CatalogIndex = {
        version: SkillsService.CATALOG_VERSION,
        lastUpdated: new Date().toISOString(),
        skills,
      };

      this.catalogCache = catalog;
      await fs.promises.writeFile(CATALOG_INDEX_PATH, JSON.stringify(catalog, null, 2));
      return this.mergeInstalledState(catalog);
    } catch (error) {
      log.error('Failed to refresh catalog:', error);
      return this.getCatalogIndex();
    }
  }

  async getInstalledSkills(): Promise<CatalogSkill[]> {
    await this.initialize();
    const seen = new Set<string>();
    const skills: CatalogSkill[] = [];

    // Scan all known skill directories (central + agent-specific)
    const dirsToScan = [SKILLS_ROOT, ...skillScanPaths];

    for (const dir of dirsToScan) {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        continue; // Directory doesn't exist
      }

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        if (seen.has(entry.name)) continue; // Already found this skill

        let skillDir = path.join(dir, entry.name);

        // Resolve symlinks to get the real path and verify it's a directory
        try {
          const realPath = await fs.promises.realpath(skillDir);
          const stat = await fs.promises.stat(realPath);
          if (!stat.isDirectory()) continue;
          skillDir = realPath;
        } catch (err) {
          log.warn(`Skipping skill "${entry.name}" in ${dir}: failed to resolve path`, err);
          continue;
        }

        const skillMdPath = path.join(skillDir, 'SKILL.md');
        try {
          const content = await fs.promises.readFile(skillMdPath, 'utf-8');
          const { frontmatter } = parseFrontmatter(content);
          seen.add(entry.name);
          skills.push({
            id: entry.name,
            displayName: frontmatter.name || entry.name,
            description: frontmatter.description || '',
            source: 'local',
            frontmatter,
            installed: true,
            localPath: skillDir,
            skillMdContent: content,
          });
        } catch {
          // No SKILL.md — not a valid skill directory, skip silently
        }
      }
    }

    return skills;
  }

  async getSkillDetail(
    skillId: string,
    source?: { owner: string; repo: string }
  ): Promise<CatalogSkill | null> {
    const catalog = await this.getCatalogIndex();
    let skill = catalog.skills.find((s) => s.id === skillId) ?? null;

    if (!skill && source) {
      skill = {
        id: skillId,
        displayName: titleCase(skillId),
        description: '',
        source: 'skills-sh',
        iconUrl: source.owner ? `https://github.com/${source.owner}.png?size=80` : undefined,
        frontmatter: { name: skillId, description: '' },
        installed: false,
        owner: source.owner,
        repo: source.repo,
      };
    }

    if (!skill) return null;

    if (skill.installed && skill.localPath) {
      try {
        const content = await fs.promises.readFile(path.join(skill.localPath, 'SKILL.md'), 'utf-8');
        return { ...skill, skillMdContent: content };
      } catch {
        // Return what we have
      }
    }

    if (!skill.installed && !skill.skillMdContent) {
      try {
        const content = await this.fetchSkillMd(skill);
        const { frontmatter: fm } = parseFrontmatter(content);
        return {
          ...skill,
          skillMdContent: content,
          description: skill.description || fm.description || '',
          displayName: skill.displayName || fm.name || titleCase(skill.id),
        };
      } catch {
        // Return what we have
      }
    }

    return skill;
  }

  /**
   * Resolve a deterministic raw-GitHub URL for OpenAI/Anthropic skills whose
   * `sourceUrl` already encodes the exact path. Returns null for skills-sh
   * skills (those need the multi-path fallback in `fetchSkillMd`).
   */
  private getKnownSkillMdUrl(skill: CatalogSkill): string | null {
    if (skill.sourceUrl) {
      const match = skill.sourceUrl.match(/github\.com\/([^/]+\/[^/]+)\/tree\/main\/(.+)/);
      if (match) {
        return `https://raw.githubusercontent.com/${match[1]}/main/${match[2]}/SKILL.md`;
      }
    }
    return null;
  }

  /**
   * Fetch SKILL.md content for any skill. Uses the GitHub Trees API for
   * skills-sh skills since file locations vary across repos.
   */
  private async fetchSkillMd(skill: CatalogSkill): Promise<string> {
    const knownUrl = this.getKnownSkillMdUrl(skill);
    if (knownUrl) return httpsGet(knownUrl);

    if (!skill.owner || !skill.repo) {
      throw new Error(`No source info for skill "${skill.id}"`);
    }

    const raw = (p: string) =>
      `https://raw.githubusercontent.com/${skill.owner}/${skill.repo}/main/${p}`;

    const treeUrl = `https://api.github.com/repos/${skill.owner}/${skill.repo}/git/trees/main?recursive=1`;
    let skillMdPaths: string[];
    try {
      const treeData = await httpsGet(treeUrl);
      const tree = JSON.parse(treeData) as {
        tree: Array<{ path: string; type: string }>;
      };
      skillMdPaths = tree.tree
        .filter((f) => f.type === 'blob' && f.path.endsWith('SKILL.md'))
        .map((f) => f.path);
    } catch {
      const guesses = [
        `skills/${skill.id}/SKILL.md`,
        'SKILL.md',
        `${skill.id}/SKILL.md`,
        `.claude/skills/${skill.id}/SKILL.md`,
      ];
      for (const p of guesses) {
        try {
          return await httpsGet(raw(p));
        } catch {
          // try next
        }
      }
      throw new Error(`SKILL.md not found for skill "${skill.id}"`);
    }

    if (skillMdPaths.length === 0) {
      throw new Error(`No SKILL.md in repo ${skill.owner}/${skill.repo}`);
    }

    if (skillMdPaths.length === 1) {
      return httpsGet(raw(skillMdPaths[0]));
    }

    const byDir = skillMdPaths.find((p) => {
      const parts = p.split('/');
      return parts.length >= 2 && parts[parts.length - 2] === skill.id;
    });
    if (byDir) return httpsGet(raw(byDir));

    for (const p of skillMdPaths) {
      try {
        const content = await httpsGet(raw(p));
        const { frontmatter: fm } = parseFrontmatter(content);
        if (fm.name === skill.id) return content;
      } catch {
        // try next
      }
    }

    return httpsGet(raw(skillMdPaths[0]));
  }

  async installSkill(
    skillId: string,
    source?: { owner: string; repo: string }
  ): Promise<CatalogSkill> {
    if (!isValidSkillName(skillId)) {
      throw new Error(`Invalid skill ID "${skillId}"`);
    }

    await this.initialize();
    const catalog = await this.getCatalogIndex();
    let skill = catalog.skills.find((s) => s.id === skillId) ?? null;

    if (!skill && source) {
      skill = {
        id: skillId,
        displayName: titleCase(skillId),
        description: '',
        source: 'skills-sh',
        iconUrl: source.owner ? `https://github.com/${source.owner}.png?size=80` : undefined,
        frontmatter: { name: skillId, description: '' },
        installed: false,
        owner: source.owner,
        repo: source.repo,
      };
    }

    if (!skill) throw new Error(`Skill "${skillId}" not found in catalog`);
    if (skill.installed) throw new Error(`Skill "${skillId}" is already installed`);

    const skillDir = path.join(SKILLS_ROOT, skillId);
    const tmpDir = `${skillDir}.tmp-${Date.now()}`;
    try {
      await fs.promises.mkdir(tmpDir, { recursive: true });

      // Try to download the real SKILL.md from GitHub; fall back to generated stub
      let content: string;
      try {
        content = await this.fetchSkillMd(skill);
      } catch {
        content = generateSkillMd(skill.displayName, skill.description);
      }
      await fs.promises.writeFile(path.join(tmpDir, 'SKILL.md'), content);

      // Remove stale target dir if present (e.g. from a previous failed install)
      await fs.promises.rm(skillDir, { recursive: true, force: true }).catch(() => {});

      // Atomic move: rename tmp dir to final location
      await fs.promises.rename(tmpDir, skillDir);

      await this.syncToAgents(skillId);

      this.catalogCache = null;

      const { frontmatter: fm } = parseFrontmatter(content);
      return {
        ...skill,
        installed: true,
        localPath: skillDir,
        skillMdContent: content,
        description: skill.description || fm.description || '',
        displayName: skill.displayName || fm.name || titleCase(skill.id),
      };
    } catch (error) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      await fs.promises.rm(skillDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async uninstallSkill(skillId: string): Promise<void> {
    if (!isValidSkillName(skillId)) {
      throw new Error(`Invalid skill ID "${skillId}"`);
    }
    const skillDir = path.join(SKILLS_ROOT, skillId);

    // Remove agent symlinks first
    await this.unsyncFromAgents(skillId);

    // Remove skill directory
    try {
      await fs.promises.rm(skillDir, { recursive: true, force: true });
    } catch (error) {
      log.error(`Failed to remove skill directory ${skillDir}:`, error);
      throw error;
    }

    // Invalidate cache
    this.catalogCache = null;
  }

  async createSkill(name: string, description: string, content?: string): Promise<CatalogSkill> {
    if (!isValidSkillName(name)) {
      throw new Error(
        'Invalid skill name. Use lowercase letters, numbers, and hyphens (1-64 chars).'
      );
    }

    await this.initialize();
    const skillDir = path.join(SKILLS_ROOT, name);

    try {
      await fs.promises.access(skillDir);
      throw new Error(`Skill "${name}" already exists`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    await fs.promises.mkdir(skillDir, { recursive: true });

    const skillContent = generateSkillMd(name, description, content?.trim());

    await fs.promises.writeFile(path.join(skillDir, 'SKILL.md'), skillContent);

    // Sync to agents
    await this.syncToAgents(name);

    // Invalidate cache
    this.catalogCache = null;

    const { frontmatter } = parseFrontmatter(skillContent);
    return {
      id: name,
      displayName: name,
      description,
      source: 'local',
      frontmatter,
      installed: true,
      localPath: skillDir,
      skillMdContent: skillContent,
    };
  }

  async syncToAgents(skillId: string): Promise<void> {
    const skillDir = path.join(SKILLS_ROOT, skillId);
    for (const target of agentTargets) {
      try {
        // Only sync if the agent's config dir exists (agent is installed)
        await fs.promises.access(target.configDir);
        const targetDir = target.getSkillDir(skillId);
        const parentDir = path.dirname(targetDir);
        await fs.promises.mkdir(parentDir, { recursive: true });

        // Remove existing symlink/dir if present
        try {
          const stat = await fs.promises.lstat(targetDir);
          if (stat.isSymbolicLink() || stat.isDirectory()) {
            await fs.promises.rm(targetDir, { recursive: true, force: true });
          }
        } catch {
          // Doesn't exist, that's fine
        }

        await fs.promises.symlink(skillDir, targetDir, 'junction');
      } catch (err) {
        // Agent not installed — expected; log unexpected failures
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
          log.warn(`Failed to sync skill "${skillId}" to ${target.name}:`, err);
        }
      }
    }
  }

  async unsyncFromAgents(skillId: string): Promise<void> {
    for (const target of agentTargets) {
      try {
        const targetDir = target.getSkillDir(skillId);
        const stat = await fs.promises.lstat(targetDir);
        if (stat.isSymbolicLink()) {
          // Only remove symlinks that point into our central skills root
          const linkTarget = await fs.promises.readlink(targetDir);
          const resolved = path.resolve(path.dirname(targetDir), linkTarget);
          if (resolved.startsWith(SKILLS_ROOT)) {
            await fs.promises.unlink(targetDir);
          }
        }
        // Never rm -rf real directories in agent config — they may be user-managed
      } catch {
        // Doesn't exist or can't remove — skip
      }
    }
  }

  async getDetectedAgents(): Promise<DetectedAgent[]> {
    const agents: DetectedAgent[] = [];
    for (const target of agentTargets) {
      let installed = false;
      try {
        await fs.promises.access(target.configDir);
        installed = true;
      } catch {
        // Not installed
      }
      agents.push({
        id: target.id,
        name: target.name,
        configDir: target.configDir,
        installed,
      });
    }
    return agents;
  }

  // --- Private helpers ---

  private loadBundledCatalog(): CatalogIndex {
    return bundledCatalog as CatalogIndex;
  }

  private async mergeInstalledState(catalog: CatalogIndex): Promise<CatalogIndex> {
    const installed = await this.getInstalledSkills();
    const installedMap = new Map(installed.map((s) => [s.id, s]));

    const dedupedSkills = deduplicateById(catalog.skills);

    const mergedSkills = dedupedSkills.map((skill) => {
      const local = installedMap.get(skill.id);
      if (local) {
        installedMap.delete(skill.id);
        return {
          ...skill,
          installed: true,
          localPath: local.localPath,
          skillMdContent: local.skillMdContent,
        };
      }
      return { ...skill, installed: false };
    });

    // Add locally-installed skills not in the catalog
    for (const local of installedMap.values()) {
      mergedSkills.push(local);
    }

    return { ...catalog, skills: mergedSkills };
  }

  private async fetchOpenAICatalog(): Promise<CatalogSkill[]> {
    const baseUrl = 'https://api.github.com/repos/openai/skills/contents/skills';
    const rawBase = 'https://raw.githubusercontent.com/openai/skills/main/skills';

    // Fetch both curated and system skills
    const [curatedData, systemData] = await Promise.all([
      httpsGet(`${baseUrl}/.curated`),
      httpsGet(`${baseUrl}/.system`).catch(() => '[]'),
    ]);

    const curatedEntries = JSON.parse(curatedData) as Array<{
      name: string;
      type: string;
      html_url?: string;
    }>;
    const systemEntries = JSON.parse(systemData) as Array<{
      name: string;
      type: string;
      html_url?: string;
    }>;

    const allEntries = [
      ...curatedEntries.map((e) => ({ ...e, category: '.curated' as const })),
      ...systemEntries.map((e) => ({ ...e, category: '.system' as const })),
    ].filter((e) => e.type === 'dir');

    // Fetch openai.yaml for each skill in parallel (with fallback)
    const skills = await Promise.all(
      allEntries.map(async (entry) => {
        const fallbackName = entry.name
          .split('-')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');

        let displayName = fallbackName;
        let description = '';
        let iconUrl: string | undefined;
        let brandColor: string | undefined;
        let defaultPrompt: string | undefined;

        try {
          const yamlUrl = `${rawBase}/${entry.category}/${entry.name}/agents/openai.yaml`;
          const yamlContent = await httpsGet(yamlUrl);
          const parsed = this.parseSimpleYaml(yamlContent);
          displayName = parsed['display_name'] || fallbackName;
          description = parsed['short_description'] || '';
          defaultPrompt = parsed['default_prompt'];
          brandColor = parsed['brand_color'];

          // Resolve icon URL from relative path
          const iconPath = parsed['icon_small'] || parsed['icon_large'];
          if (iconPath) {
            const cleanPath = iconPath.replace(/^\.\//, '');
            iconUrl = `${rawBase}/${entry.category}/${entry.name}/${cleanPath}`;
          }
        } catch {
          // No openai.yaml — use fallback
        }

        // If still no description, try fetching SKILL.md frontmatter
        if (!description) {
          try {
            const mdUrl = `${rawBase}/${entry.category}/${entry.name}/SKILL.md`;
            const md = await httpsGet(mdUrl);
            const { frontmatter: fm } = parseFrontmatter(md);
            if (fm.description) description = fm.description;
          } catch {
            // Use empty string
          }
        }

        if (!description) {
          description = `${entry.name.replace(/-/g, ' ')}`;
        }

        const skill: CatalogSkill = {
          id: entry.name,
          displayName,
          description,
          source: 'openai',
          sourceUrl: entry.html_url,
          iconUrl,
          brandColor: brandColor || '#10a37f',
          defaultPrompt,
          frontmatter: { name: entry.name, description },
          installed: false,
        };
        return skill;
      })
    );

    return skills;
  }

  private async fetchAnthropicCatalog(): Promise<CatalogSkill[]> {
    const url = 'https://api.github.com/repos/anthropics/skills/contents/skills';
    const rawBase = 'https://raw.githubusercontent.com/anthropics/skills/main/skills';
    const data = await httpsGet(url);
    const entries = JSON.parse(data) as Array<{ name: string; type: string; html_url?: string }>;
    const skills: CatalogSkill[] = [];

    for (const entry of entries) {
      if (entry.type !== 'dir') continue;
      const fallbackName = entry.name
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

      let description = '';

      // Try to get description from SKILL.md frontmatter
      try {
        const mdUrl = `${rawBase}/${entry.name}/SKILL.md`;
        const md = await httpsGet(mdUrl);
        const { frontmatter: fm } = parseFrontmatter(md);
        if (fm.description) description = fm.description;
      } catch {
        // Use fallback
      }

      if (!description) {
        description = `${entry.name.replace(/-/g, ' ')}`;
      }

      skills.push({
        id: entry.name,
        displayName: fallbackName,
        description,
        source: 'anthropic',
        sourceUrl: entry.html_url,
        brandColor: '#d4a574',
        frontmatter: { name: entry.name, description },
        installed: false,
      });
    }

    return skills;
  }

  /**
   * Search the skills.sh ecosystem via their public API.
   * Returns up to 100 matching skills sorted by relevance/installs.
   */
  async searchSkillsSh(query: string): Promise<CatalogSkill[]> {
    if (query.length < 2) return [];

    const url = `${SKILLS_SH_SEARCH_URL}?q=${encodeURIComponent(query)}`;
    const data = await httpsGet(url);
    const result = JSON.parse(data) as SkillsShSearchResult;

    if (!result.skills || !Array.isArray(result.skills)) return [];

    const installed = await this.getInstalledSkills();
    const installedIds = new Set(installed.map((s) => s.id));

    return result.skills
      .filter((s) => s.skillId && s.source)
      .map((s) => {
        const slashIdx = s.source.indexOf('/');
        const owner = slashIdx > 0 ? s.source.slice(0, slashIdx) : s.source;
        const repo = slashIdx > 0 ? s.source.slice(slashIdx + 1) : '';

        const isInstalled = installedIds.has(s.skillId);
        const localSkill = isInstalled ? installed.find((i) => i.id === s.skillId) : undefined;

        return {
          id: s.skillId,
          displayName: titleCase(s.skillId),
          description: '',
          source: 'skills-sh' as const,
          brandColor: '#171717',
          iconUrl: owner ? `https://github.com/${owner}.png?size=80` : undefined,
          frontmatter: { name: s.skillId, description: '' },
          installed: isInstalled,
          localPath: localSkill?.localPath,
          owner,
          repo,
          installs: s.installs,
        };
      });
  }

  /**
   * Fetch a browse listing (all-time, trending, or hot) from skills.sh.
   * skills.sh has no public JSON endpoint for these views, so we read the
   * server-rendered page and extract the `initialSkills` payload embedded
   * in the Next.js RSC stream. Cached in memory for 5 minutes per kind.
   */
  async browseSkillsSh(kind: SkillsShBrowseKind): Promise<CatalogSkill[]> {
    const cached = this.browseCache.get(kind);
    if (cached && Date.now() - cached.at < SKILLS_SH_BROWSE_TTL_MS) {
      return this.mergeInstalledStateForSkillsShList(cached.skills);
    }

    const html = await httpsGet(`${SKILLS_SH_BASE_URL}${BROWSE_PATHS[kind]}`, 0, {
      'User-Agent': 'Mozilla/5.0 emdash-skills',
      Accept: 'text/html',
    });

    const entries = this.extractInitialSkills(html);
    const skills = entries.map((e) => this.skillsShEntryToCatalogSkill(e));

    this.browseCache.set(kind, { at: Date.now(), skills });
    return this.mergeInstalledStateForSkillsShList(skills);
  }

  private extractInitialSkills(
    html: string
  ): Array<{ skillId: string; name: string; installs: number; source: string }> {
    const marker = '\\"initialSkills\\":[';
    const markerIdx = html.indexOf(marker);
    if (markerIdx === -1) return [];
    const start = html.indexOf('[', markerIdx);
    if (start === -1) return [];

    let depth = 0;
    let end = -1;
    for (let i = start; i < html.length; i++) {
      const c = html[i];
      if (c === '[') depth++;
      else if (c === ']') {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end === -1) return [];

    const raw = html.slice(start, end);
    const unescaped = raw.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    try {
      const parsed = JSON.parse(unescaped) as Array<{
        skillId?: string;
        name?: string;
        installs?: number;
        source?: string;
      }>;
      return parsed.filter(
        (s): s is { skillId: string; name: string; installs: number; source: string } =>
          typeof s.skillId === 'string' &&
          typeof s.source === 'string' &&
          typeof s.installs === 'number'
      );
    } catch {
      return [];
    }
  }

  private skillsShEntryToCatalogSkill(entry: {
    skillId: string;
    name: string;
    installs: number;
    source: string;
  }): CatalogSkill {
    const slashIdx = entry.source.indexOf('/');
    const owner = slashIdx > 0 ? entry.source.slice(0, slashIdx) : entry.source;
    const repo = slashIdx > 0 ? entry.source.slice(slashIdx + 1) : '';
    return {
      id: entry.skillId,
      displayName: titleCase(entry.skillId),
      description: '',
      source: 'skills-sh' as const,
      brandColor: '#171717',
      iconUrl: owner ? `https://github.com/${owner}.png?size=80` : undefined,
      frontmatter: { name: entry.skillId, description: '' },
      installed: false,
      owner,
      repo,
      installs: entry.installs,
    };
  }

  private async mergeInstalledStateForSkillsShList(
    skills: CatalogSkill[]
  ): Promise<CatalogSkill[]> {
    const installed = await this.getInstalledSkills();
    const byId = new Map(installed.map((s) => [s.id, s]));
    return skills.map((s) => {
      const local = byId.get(s.id);
      return local ? { ...s, installed: true, localPath: local.localPath } : s;
    });
  }

  /** Minimal YAML parser for openai.yaml interface block */
  private parseSimpleYaml(content: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const match = line.match(/^\s+(\w+):\s*"?([^"]*)"?\s*$/);
      if (match) {
        result[match[1]] = match[2].trim();
      }
    }
    return result;
  }
}

export const skillsService = new SkillsService();
