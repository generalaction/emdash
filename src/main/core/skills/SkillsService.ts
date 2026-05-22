import * as fs from 'node:fs';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import { log } from '@main/lib/logger';
import { agentTargets, skillScanPaths } from '@shared/skills/agentTargets';
import type { CatalogIndex, CatalogSkill, DetectedAgent } from '@shared/skills/types';
import { generateSkillMd, isValidSkillName, parseFrontmatter } from '@shared/skills/validation';
import bundledCatalog from './bundled-catalog.json';

const SKILLS_ROOT = path.join(os.homedir(), '.agentskills');
const EMDASH_META = path.join(SKILLS_ROOT, '.emdash');
const CATALOG_INDEX_PATH = path.join(EMDASH_META, 'catalog-index.json');

const MAX_REDIRECTS = 5;
const MAX_HTTP_RESPONSE_BYTES = 2 * 1024 * 1024;
const SKILLSH_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;

function httpsGet(
  url: string,
  options: { maxBytes?: number; redirectCount?: number } = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const redirectCount = options.redirectCount ?? 0;
    if (redirectCount >= MAX_REDIRECTS) {
      reject(new Error(`Too many redirects (>${MAX_REDIRECTS}) for ${url}`));
      return;
    }
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'emdash-skills', Accept: 'application/vnd.github.v3+json' } },
      (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location;
          if (location) {
            const resolved = new URL(location, url).href;
            httpsGet(resolved, { ...options, redirectCount: redirectCount + 1 }).then(
              resolve,
              reject
            );
            return;
          }
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        let data = '';
        let bytes = 0;
        const maxBytes = options.maxBytes ?? MAX_HTTP_RESPONSE_BYTES;
        res.on('data', (chunk: Buffer | string) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > maxBytes) {
            req.destroy(new Error(`Response too large for ${url}`));
            return;
          }
          data += chunk;
        });
        res.on('end', () => resolve(data));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error('Request timed out'));
    });
  });
}

export class SkillsService {
  private static readonly CATALOG_VERSION = 2;
  private catalogCache: CatalogIndex | null = null;
  private skillShSearchCache = new Map<string, { expiresAt: number; skills: CatalogSkill[] }>();
  private skillShSkillCache = new Map<string, CatalogSkill>();

  async initialize(): Promise<void> {
    await fs.promises.mkdir(SKILLS_ROOT, { recursive: true });
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

      // Deduplicate by id — first occurrence wins
      const seen = new Set<string>();
      const skills = allSkills.filter((s) => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      });

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

  async getSkillDetail(skillId: string): Promise<CatalogSkill | null> {
    const catalog = await this.getCatalogIndex();
    const skill = catalog.skills.find((s) => s.id === skillId) ?? this.parseSkillShId(skillId);
    if (!skill) return null;

    // If installed, load the full SKILL.md from disk
    if (skill.installed && skill.localPath) {
      try {
        const content = await fs.promises.readFile(path.join(skill.localPath, 'SKILL.md'), 'utf-8');
        return { ...skill, skillMdContent: content };
      } catch {
        // Return what we have
      }
    }

    // For uninstalled catalog skills, fetch SKILL.md from GitHub
    if (!skill.installed && !skill.skillMdContent) {
      try {
        if (skill.source === 'skillssh') {
          const content = await this.fetchSkillShSkillMd(skill);
          return { ...skill, skillMdContent: content };
        } else {
          const mdUrl = this.getSkillMdUrl(skill);
          if (!mdUrl) return skill;
          const content = await httpsGet(mdUrl);
          return { ...skill, skillMdContent: content };
        }
      } catch {
        // Return what we have
      }
    }

    return skill;
  }

  private getSkillMdUrl(skill: CatalogSkill): string | null {
    if (skill.source === 'skillssh' && skill.sourceRef && skill.catalogSkillId) {
      return null;
    }
    if (skill.source === 'openai' && skill.sourceUrl) {
      // e.g. https://github.com/openai/skills/tree/main/skills/.curated/linear
      // → https://raw.githubusercontent.com/openai/skills/main/skills/.curated/linear/SKILL.md
      const match = skill.sourceUrl.match(/github\.com\/([^/]+\/[^/]+)\/tree\/main\/(.+)/);
      if (match) {
        return `https://raw.githubusercontent.com/${match[1]}/main/${match[2]}/SKILL.md`;
      }
    }
    if (skill.source === 'anthropic' && skill.sourceUrl) {
      const match = skill.sourceUrl.match(/github\.com\/([^/]+\/[^/]+)\/tree\/main\/(.+)/);
      if (match) {
        return `https://raw.githubusercontent.com/${match[1]}/main/${match[2]}/SKILL.md`;
      }
    }
    return null;
  }

  async installSkill(skillId: string): Promise<CatalogSkill> {
    await this.initialize();
    const catalog = await this.getCatalogIndex();
    const skill = catalog.skills.find((s) => s.id === skillId) ?? this.parseSkillShId(skillId);
    if (!skill) throw new Error(`Skill "${skillId}" not found in catalog`);
    if (skill.installed) throw new Error(`Skill "${skillId}" is already installed`);

    const installName = this.getInstallName(skill);
    if (!isValidSkillName(installName)) {
      throw new Error(`Invalid skill install name "${installName}"`);
    }
    const skillDir = path.resolve(SKILLS_ROOT, installName);
    if (!this.isPathInsideSkillsRoot(skillDir)) {
      throw new Error(`Invalid skill install path for "${installName}"`);
    }
    const tmpDir = `${skillDir}.tmp-${Date.now()}`;
    let finalDirCreated = false;
    try {
      try {
        await fs.promises.access(skillDir);
        throw new Error(`Skill "${installName}" is already installed`);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }

      await fs.promises.mkdir(tmpDir, { recursive: true });

      // Try to download the real SKILL.md from GitHub; fall back to generated stub
      let content: string;
      if (skill.source === 'skillssh') {
        content = await this.fetchSkillShSkillMd(skill);
      } else {
        try {
          const mdUrl = this.getSkillMdUrl(skill);
          if (mdUrl) {
            content = await httpsGet(mdUrl);
          } else {
            content = generateSkillMd(skill.displayName, skill.description);
          }
        } catch {
          content = generateSkillMd(skill.displayName, skill.description);
        }
      }
      await fs.promises.writeFile(path.join(tmpDir, 'SKILL.md'), content);

      // Atomic move: rename tmp dir to final location
      await fs.promises.rename(tmpDir, skillDir);
      finalDirCreated = true;

      // Sync to agents
      await this.syncToAgents(installName);

      // Invalidate cache
      this.catalogCache = null;

      return {
        ...skill,
        id: installName,
        installed: true,
        localPath: skillDir,
        skillMdContent: content,
      };
    } catch (error) {
      // Clean up partial install
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      if (finalDirCreated) {
        await fs.promises.rm(skillDir, { recursive: true, force: true }).catch(() => {});
      }
      throw error;
    }
  }

  async uninstallSkill(skillId: string): Promise<void> {
    const skillDir = path.join(SKILLS_ROOT, skillId);

    // Remove agent symlinks first. Never delete real directories from agent config paths —
    // those may be user-managed skills that Emdash only discovered.
    await this.unsyncFromAgents(skillId);

    try {
      const stat = await fs.promises.lstat(skillDir);
      if (stat.isSymbolicLink()) {
        await fs.promises.unlink(skillDir);
      } else if (stat.isDirectory()) {
        await fs.promises.rm(skillDir, { recursive: true, force: true });
      } else {
        log.warn(`Unexpected entry type at ${skillDir} during uninstall — skipping`);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        log.error(`Failed to remove skill directory ${skillDir}:`, error);
        throw error;
      }
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
    const syncPaths = [
      ...agentTargets.map((target) => target.getSkillDir(skillId)),
      ...skillScanPaths.map((scanPath) => path.join(scanPath, skillId)),
    ];

    for (const targetDir of new Set(syncPaths)) {
      try {
        const stat = await fs.promises.lstat(targetDir);
        if (stat.isSymbolicLink()) {
          // Only remove symlinks that point into our central skills root.
          const linkTarget = await fs.promises.readlink(targetDir);
          const resolved = path.resolve(path.dirname(targetDir), linkTarget);
          if (this.isPathInsideSkillsRoot(resolved)) {
            await fs.promises.unlink(targetDir);
          }
        }
        // Never rm -rf real directories in agent config — they may be user-managed.
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

  async searchSkillSh(query: string): Promise<CatalogSkill[]> {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];

    const cached = this.skillShSearchCache.get(trimmed);
    if (cached && cached.expiresAt > Date.now()) return cached.skills;

    const url = `https://skills.sh/api/search?q=${encodeURIComponent(trimmed)}`;
    try {
      const data = await httpsGet(url);
      const result = JSON.parse(data) as {
        skills?: Array<{
          id: string;
          skillId: string;
          name?: string;
          source: string;
          installs?: number;
          isDuplicate?: boolean;
        }>;
      };

      const skills: CatalogSkill[] = [];
      for (const entry of result.skills ?? []) {
        if (!this.isSkillShGithubSource(entry.source)) continue;
        if (skills.length >= 24) break;

        const catalogSkillId = this.normalizeSkillShSkillId(entry.skillId);
        if (!isValidSkillName(catalogSkillId)) continue;
        const skillShPath = this.normalizeSkillShPath(entry.skillId);
        const displayName = entry.name || catalogSkillId;
        const sourceUrl = this.getSkillShUrl(entry.source, catalogSkillId);

        skills.push({
          id: this.toSkillShId(entry.source, catalogSkillId),
          displayName,
          description: `${entry.source}${entry.installs ? ` • ${entry.installs.toLocaleString()} installs` : ''}`,
          source: 'skillssh',
          sourceRef: entry.source,
          sourceUrl,
          catalogSkillId,
          skillShPath,
          installs: entry.installs,
          iconUrl: this.getSkillShIconUrl(entry.source),
          brandColor: '#000000',
          frontmatter: { name: catalogSkillId, description: displayName },
          installed: false,
        });
      }

      this.skillShSearchCache.set(trimmed, {
        expiresAt: Date.now() + SKILLSH_SEARCH_CACHE_TTL_MS,
        skills,
      });
      for (const skill of skills) {
        this.skillShSkillCache.set(skill.id, skill);
      }
      return skills;
    } catch (error) {
      if (cached) {
        log.warn(`Skills.SH search failed for "${trimmed}", using stale cache`, error);
        return cached.skills;
      }
      log.warn(`Skills.SH search failed for "${trimmed}"`, error);
      return [];
    }
  }

  // --- Private helpers ---

  private toSkillShId(sourceRef: string, skillId: string): string {
    return `skillssh:${sourceRef}/${this.normalizeSkillShSkillId(skillId)}`;
  }

  private normalizeSkillShSkillId(skillId: string): string {
    const normalized = skillId.replace(/\\/g, '/').replace(/\/+$/, '');
    const withoutSkillMd = normalized.endsWith('/SKILL.md')
      ? normalized.slice(0, -'/SKILL.md'.length)
      : normalized;
    return path.posix.basename(withoutSkillMd);
  }

  private normalizeSkillShPath(skillId: string): string {
    const normalized = skillId.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return normalized.endsWith('/SKILL.md') ? normalized.slice(0, -'/SKILL.md'.length) : normalized;
  }

  private isSkillShGithubSource(sourceRef: string): boolean {
    const parts = sourceRef.split('/');
    return parts.length === 2 && Boolean(parts[0]) && Boolean(parts[1]);
  }

  private parseSkillShId(skillId: string): CatalogSkill | null {
    return this.skillShSkillCache.get(skillId) ?? null;
  }

  private getInstallName(skill: CatalogSkill): string {
    return skill.source === 'skillssh' && skill.catalogSkillId
      ? this.normalizeSkillShSkillId(skill.catalogSkillId)
      : skill.id;
  }

  private getSkillShUrl(sourceRef: string, skillId: string): string {
    return `https://skills.sh/${sourceRef}/${skillId}`;
  }

  private getSkillShIconUrl(sourceRef: string): string | undefined {
    const [owner, repo] = sourceRef.split('/');
    if (!owner || !repo || sourceRef.split('/').length !== 2) return undefined;
    return `https://github.com/${owner}.png?size=80`;
  }

  private async fetchSkillShSkillMd(skill: CatalogSkill): Promise<string> {
    if (!skill.sourceRef || !skill.catalogSkillId) {
      throw new Error('Invalid Skills.SH skill reference');
    }
    const [owner, repo] = skill.sourceRef.split('/');
    if (!owner || !repo || skill.sourceRef.split('/').length !== 2) {
      throw new Error(`Skills.SH source "${skill.sourceRef}" is not a GitHub repository`);
    }

    if (!skill.skillShPath) {
      throw new Error(`Could not find SKILL.md for ${skill.sourceRef}/${skill.catalogSkillId}`);
    }

    const skillMdPath = `${skill.skillShPath}/SKILL.md`;
    const encodedPath = skillMdPath.split('/').map(encodeURIComponent).join('/');
    return httpsGet(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${encodedPath}`);
  }

  private isPathInsideSkillsRoot(candidatePath: string): boolean {
    const relativePath = path.relative(SKILLS_ROOT, candidatePath);
    return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
  }

  private loadBundledCatalog(): CatalogIndex {
    return bundledCatalog as CatalogIndex;
  }

  private async mergeInstalledState(catalog: CatalogIndex): Promise<CatalogIndex> {
    const installed = await this.getInstalledSkills();
    const installedMap = new Map(installed.map((s) => [s.id, s]));

    // Deduplicate catalog skills by id (first occurrence wins)
    const seen = new Set<string>();
    const dedupedSkills = catalog.skills.filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });

    const mergedSkills = dedupedSkills.map((skill) => {
      const local = installedMap.get(skill.id);
      if (local) {
        installedMap.delete(skill.id);
        return {
          ...skill,
          displayName: local.displayName || skill.displayName,
          description: local.description || skill.description,
          frontmatter: { ...skill.frontmatter, ...local.frontmatter },
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
