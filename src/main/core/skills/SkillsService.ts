import * as fs from 'node:fs';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import { agentTargets, skillScanPaths } from '@shared/skills/agentTargets';
import {
  mergeCatalogSkills,
  SKILLSSH_BASE,
  toSkillsshCatalogSkill,
  type SkillsshDetailResponse,
  type SkillsshSearchResponse,
} from '@shared/skills/skillssh';
import type { CatalogIndex, CatalogSkill, DetectedAgent } from '@shared/skills/types';
import { generateSkillMd, isValidSkillName, parseFrontmatter } from '@shared/skills/validation';
import { log } from '@main/lib/logger';
import bundledCatalog from './bundled-catalog.json';

const SKILLS_ROOT = path.join(os.homedir(), '.agentskills');
const EMDASH_META = path.join(SKILLS_ROOT, '.emdash');
const CATALOG_INDEX_PATH = path.join(EMDASH_META, 'catalog-index.json');

const MAX_REDIRECTS = 5;

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function editDistanceWithin(a: string, b: string, maxDistance: number): boolean {
  if (Math.abs(a.length - b.length) > maxDistance) return false;
  if (a === b) return true;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = current[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current[j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > maxDistance) return false;
    previous = current;
  }

  return previous[b.length] <= maxDistance;
}

function skillMatchesCatalogSearch(skill: CatalogSkill, query: string): boolean {
  const lower = query.toLowerCase();
  if (
    skill.id.toLowerCase().includes(lower) ||
    skill.displayName.toLowerCase().includes(lower) ||
    skill.description.toLowerCase().includes(lower)
  ) {
    return true;
  }

  if (!skill.repoSlug) return false;

  const [owner] = skill.repoSlug.split('/');
  const normalizedQuery = normalizeSearchText(query);
  const normalizedOwner = normalizeSearchText(owner ?? '');
  const normalizedRepoSlug = normalizeSearchText(skill.repoSlug);
  if (!normalizedQuery) return false;

  return (
    normalizedOwner.includes(normalizedQuery) ||
    normalizedRepoSlug.includes(normalizedQuery) ||
    (normalizedQuery.length >= 4 && editDistanceWithin(normalizedQuery, normalizedOwner, 2))
  );
}

function httpsGet(url: string, redirectCount = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    if (redirectCount >= MAX_REDIRECTS) {
      reject(new Error(`Too many redirects (>${MAX_REDIRECTS}) for ${url}`));
      return;
    }
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'emdash-skills', Accept: 'application/json, text/html, */*' } },
      (res) => {
        const status = res.statusCode ?? 0;
        // Follow any 3xx redirect (skills.sh uses 307, GitHub uses 301/302)
        if (status >= 300 && status < 400 && res.headers.location) {
          const resolved = new URL(res.headers.location, url).href;
          res.resume();
          httpsGet(resolved, redirectCount + 1).then(resolve, reject);
          return;
        }
        if (status >= 400) {
          reject(new Error(`HTTP ${status} for ${url}`));
          return;
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
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
  private static readonly CATALOG_VERSION = 4;
  private catalogCache: CatalogIndex | null = null;
  private searchSkillCache = new Map<string, CatalogSkill>();

  async initialize(): Promise<void> {
    await fs.promises.mkdir(SKILLS_ROOT, { recursive: true });
    await fs.promises.mkdir(EMDASH_META, { recursive: true });
  }

  async getCatalogIndex(): Promise<CatalogIndex> {
    if (this.catalogCache) {
      return this.mergeInstalledState(this.catalogCache);
    }

    // Prefer the disk cache on cold start so the Skills view is not blocked by
    // a slow network request. Refresh explicitly fetches skills.sh.
    try {
      const data = await fs.promises.readFile(CATALOG_INDEX_PATH, 'utf-8');
      const diskCache = JSON.parse(data) as CatalogIndex;
      if (diskCache.version >= SkillsService.CATALOG_VERSION) {
        this.catalogCache = diskCache;
        return this.mergeInstalledState(this.catalogCache);
      }
      // Stale disk cache — fall through to remote/bundled
    } catch {
      // No disk cache — fall back to remote/bundled catalog
    }

    try {
      const catalog = await this.fetchRemoteCatalog();
      this.catalogCache = catalog;
      return this.mergeInstalledState(catalog);
    } catch (error) {
      log.warn('Failed to load remote skills catalog, using bundled catalog', error);
    }

    const bundled = this.loadBundledCatalog();
    this.catalogCache = bundled;
    return this.mergeInstalledState(bundled);
  }

  async refreshCatalog(): Promise<CatalogIndex> {
    try {
      const catalog = await this.fetchRemoteCatalog();
      this.catalogCache = catalog;
      return this.mergeInstalledState(catalog);
    } catch (error) {
      log.error('Failed to refresh catalog:', error);
      return this.getCatalogIndex();
    }
  }

  async searchCatalog(query: string): Promise<CatalogIndex> {
    const q = query.trim();
    if (q.length < 2) {
      return this.getCatalogIndex();
    }

    const installed = await this.getInstalledSkills().catch(() => [] as CatalogSkill[]);
    const installedById = new Map(installed.map((s) => [s.id, s]));

    try {
      const searchSkills = await this.fetchSkillsshSearch(q);
      for (const skill of searchSkills) {
        this.searchSkillCache.set(skill.id, skill);
      }
      const catalog = this.catalogCache ?? (await this.getCatalogIndex().catch(() => null));
      const catalogById = catalog
        ? new Map(catalog.skills.map((s) => [s.id, s]))
        : new Map<string, CatalogSkill>();

      // Hydrate search hits with richer metadata (sourceUrl/icons/etc.) from the cached
      // catalog when available, and mark installed if locally present.
      const hydrated = searchSkills.map<CatalogSkill>((hit) => {
        const local = installedById.get(hit.id);
        const fromCatalog = catalogById.get(hit.id);
        const base = fromCatalog ? { ...fromCatalog, ...hit } : hit;
        if (local) {
          return {
            ...base,
            installed: true,
            localPath: local.localPath,
            skillMdContent: local.skillMdContent,
          };
        }
        return { ...base, installed: false };
      });

      // Include catalog/installed skills that match locally, including skills.sh author slugs.
      const seenIds = new Set(hydrated.map((s) => s.id));
      for (const catalogSkill of catalog?.skills ?? []) {
        if (seenIds.has(catalogSkill.id)) continue;
        if (skillMatchesCatalogSearch(catalogSkill, q)) {
          const local = installedById.get(catalogSkill.id);
          hydrated.push(
            local
              ? {
                  ...catalogSkill,
                  installed: true,
                  localPath: local.localPath,
                  skillMdContent: local.skillMdContent,
                }
              : { ...catalogSkill, installed: false }
          );
          seenIds.add(catalogSkill.id);
        }
      }
      for (const local of installed) {
        if (seenIds.has(local.id)) continue;
        if (skillMatchesCatalogSearch(local, q)) {
          hydrated.unshift(local);
          seenIds.add(local.id);
        }
      }

      log.info(`skills.sh search "${q}" returned ${hydrated.length} hits`);

      return {
        version: SkillsService.CATALOG_VERSION,
        lastUpdated: new Date().toISOString(),
        skills: hydrated,
      };
    } catch (error) {
      log.warn('Failed to search skills.sh catalog:', error);
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
    const skill = await this.findCatalogSkill(skillId);
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
        let content: string | null = null;
        if (skill.source === 'skillssh') {
          content = await this.fetchSkillsshSkillMd(skill);
        } else {
          const mdUrl = this.getSkillMdUrl(skill);
          if (mdUrl) {
            content = await httpsGet(mdUrl);
          }
        }
        if (content) {
          const { frontmatter } = parseFrontmatter(content);
          return {
            ...skill,
            skillMdContent: content,
            description: frontmatter.description || skill.description,
            frontmatter: { ...skill.frontmatter, ...frontmatter },
          };
        }
      } catch {
        // Return what we have
      }
    }

    return skill;
  }

  private async fetchSkillsshSkillMd(skill: CatalogSkill): Promise<string | null> {
    const detail = await this.fetchSkillsshDetail(skill);
    const skillMd = detail?.files?.find((file) => file.path.toLowerCase() === 'skill.md');
    return skillMd?.contents ?? null;
  }

  private getSkillMdUrl(skill: CatalogSkill): string | null {
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
    const skill = await this.findCatalogSkill(skillId);
    if (!skill) throw new Error(`Skill "${skillId}" not found in catalog`);
    if (skill.installed) throw new Error(`Skill "${skillId}" is already installed`);

    const skillDir = path.join(SKILLS_ROOT, skillId);
    const tmpDir = `${skillDir}.tmp-${Date.now()}`;
    try {
      await fs.promises.mkdir(tmpDir, { recursive: true });

      // Try to download the real skill files; fall back to a generated SKILL.md stub.
      let content: string;
      try {
        if (skill.source === 'skillssh') {
          content = await this.writeSkillsshFiles(skill, tmpDir);
        } else {
          const mdUrl = this.getSkillMdUrl(skill);
          if (mdUrl) {
            content = await httpsGet(mdUrl);
          } else {
            content = generateSkillMd(skill.displayName, skill.description);
          }
          await fs.promises.writeFile(path.join(tmpDir, 'SKILL.md'), content);
        }
      } catch {
        // writeSkillsshFiles may have left partial files in tmpDir — start fresh
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
        await fs.promises.mkdir(tmpDir, { recursive: true });
        content = generateSkillMd(skill.displayName, skill.description);
        await fs.promises.writeFile(path.join(tmpDir, 'SKILL.md'), content);
      }

      // Remove stale target dir if present (e.g. from a previous failed install)
      await fs.promises.rm(skillDir, { recursive: true, force: true }).catch(() => {});

      // Atomic move: rename tmp dir to final location
      await fs.promises.rename(tmpDir, skillDir);

      // Sync to agents
      await this.syncToAgents(skillId);

      // Invalidate cache
      this.catalogCache = null;
      this.searchSkillCache.delete(skillId);

      return {
        ...skill,
        installed: true,
        localPath: skillDir,
        skillMdContent: content,
      };
    } catch (error) {
      // Clean up partial install
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      await fs.promises.rm(skillDir, { recursive: true, force: true }).catch(() => {});
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

        // Remove existing Emdash-managed symlink if present. Do not delete real
        // agent skill directories; those may be user-managed.
        try {
          const stat = await fs.promises.lstat(targetDir);
          if (stat.isSymbolicLink()) {
            await fs.promises.unlink(targetDir);
          } else {
            log.warn(`Skipping sync of skill "${skillId}" to ${target.name}: target exists`);
            continue;
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

  // --- Private helpers ---

  private isPathInsideSkillsRoot(candidatePath: string): boolean {
    const relativePath = path.relative(SKILLS_ROOT, candidatePath);
    return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
  }

  private loadBundledCatalog(): CatalogIndex {
    return bundledCatalog as CatalogIndex;
  }

  private async findCatalogSkill(skillId: string): Promise<CatalogSkill | undefined> {
    const cachedSearchSkill = this.searchSkillCache.get(skillId);
    if (cachedSearchSkill) return cachedSearchSkill;
    const catalog = await this.getCatalogIndex();
    return catalog.skills.find((s) => s.id === skillId);
  }

  private async fetchRemoteCatalog(): Promise<CatalogIndex> {
    const bundledSkills = this.loadBundledCatalog().skills;
    const skillsshSkills = await this.fetchSkillsshCatalog();
    const skills = mergeCatalogSkills(bundledSkills, skillsshSkills);

    if (skills.length === 0) {
      throw new Error('skills.sh catalog returned no skills');
    }

    const catalog: CatalogIndex = {
      version: SkillsService.CATALOG_VERSION,
      lastUpdated: new Date().toISOString(),
      skills,
    };

    await fs.promises.writeFile(CATALOG_INDEX_PATH, JSON.stringify(catalog, null, 2));
    return catalog;
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

  private async fetchSkillsshCatalog(): Promise<CatalogSkill[]> {
    const catalogQueries = ['skill', 'ai', 'agent', 'code', 'docs', 'github', 'react', 'cloud'];
    const results = await Promise.allSettled(
      catalogQueries.map((query) => this.fetchSkillsshSearch(query, 100))
    );
    const skillGroups = results
      .filter(
        (result): result is PromiseFulfilledResult<CatalogSkill[]> => result.status === 'fulfilled'
      )
      .map((result) => result.value);

    if (skillGroups.length === 0) {
      throw new Error('All skills.sh catalog queries failed');
    }

    return mergeCatalogSkills(...skillGroups);
  }

  private async fetchSkillsshSearch(query: string, limit = 50): Promise<CatalogSkill[]> {
    const data = await httpsGet(
      `${SKILLSSH_BASE}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`
    );
    const response = JSON.parse(data) as SkillsshSearchResponse;

    return response.skills.map((entry) =>
      toSkillsshCatalogSkill({
        name: entry.name,
        skillId: entry.skillId,
        source: entry.source,
        installs: entry.installs,
      })
    );
  }

  private getSkillsshPath(skill: CatalogSkill): string | null {
    if (!skill.sourceUrl) return null;
    try {
      const url = new URL(skill.sourceUrl);
      if (url.hostname !== 'skills.sh' && url.hostname !== 'www.skills.sh') return null;
      const skillPath = url.pathname.replace(/^\/+/, '');
      return skillPath.length > 0 ? skillPath : null;
    } catch {
      return null;
    }
  }

  private async fetchSkillsshDetail(skill: CatalogSkill): Promise<SkillsshDetailResponse | null> {
    const skillPath = this.getSkillsshPath(skill);
    if (!skillPath) return null;

    const data = await httpsGet(`${SKILLSSH_BASE}/api/download/${skillPath}`);
    return JSON.parse(data) as SkillsshDetailResponse;
  }

  private async writeSkillsshFiles(skill: CatalogSkill, targetDir: string): Promise<string> {
    const detail = await this.fetchSkillsshDetail(skill);
    const files = detail?.files;
    if (!files || files.length === 0) {
      throw new Error(`No files available for ${skill.id}`);
    }

    let skillMdContent: string | null = null;
    for (const file of files) {
      const targetPath = path.resolve(targetDir, file.path);
      if (!this.isPathInside(targetDir, targetPath)) {
        throw new Error(`Unsafe skill file path: ${file.path}`);
      }

      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.promises.writeFile(targetPath, file.contents);

      if (file.path.toLowerCase() === 'skill.md') {
        skillMdContent = file.contents;
      }
    }

    if (!skillMdContent) {
      throw new Error(`Skill ${skill.id} did not include SKILL.md`);
    }

    return skillMdContent;
  }

  private isPathInside(parentDir: string, childPath: string): boolean {
    const relative = path.relative(path.resolve(parentDir), childPath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }
}

export const skillsService = new SkillsService();
