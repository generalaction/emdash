import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import { log } from '@main/lib/logger';
import type { CatalogIndex, CatalogSkill } from '@shared/core/skills/types';
import {
  generateSkillMd,
  isValidSkillName,
  parseFrontmatter,
} from '@shared/core/skills/validation';
import bundledCatalog from './bundled-catalog.json';

const SKILLS_ROOT = path.join(os.homedir(), '.agentskills');
const EMDASH_META = path.join(SKILLS_ROOT, '.emdash');
const CATALOG_INDEX_PATH = path.join(EMDASH_META, 'catalog-index.json');
const SKILLSH_INSTALLS_PATH = path.join(EMDASH_META, 'skillssh-installs.json');

/**
 * Persisted Skills.SH provenance, keyed by local install directory name.
 * Lets us reattach the skillssh source + icon to installed skills, which the
 * filesystem scan alone cannot recover.
 */
interface SkillShInstallRecord {
  sourceRef: string;
  catalogSkillId: string;
  skillShPath: string;
}

const MAX_REDIRECTS = 5;
const MAX_HTTP_RESPONSE_BYTES = 2 * 1024 * 1024;
const SKILLSH_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const SKILLSH_SKILL_CACHE_MAX_ENTRIES = 200;
const MAX_SKILL_NAME_LENGTH = 64;

class HttpStatusError extends Error {
  constructor(
    public readonly statusCode: number,
    url: string
  ) {
    super(`HTTP ${statusCode} for ${url}`);
    this.name = 'HttpStatusError';
  }
}

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
          reject(new HttpStatusError(res.statusCode, url));
          return;
        }
        let data = '';
        let bytes = 0;
        let destroyed = false;
        const maxBytes = options.maxBytes ?? MAX_HTTP_RESPONSE_BYTES;
        res.on('data', (chunk: Buffer | string) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > maxBytes) {
            destroyed = true;
            req.destroy(new Error(`Response too large for ${url}`));
            return;
          }
          data += chunk;
        });
        res.on('end', () => {
          if (!destroyed) resolve(data);
        });
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
    const skillShInstalls = await this.readPrunedSkillShInstalls();

    const dirsToScan = [SKILLS_ROOT];

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
          const skillSh = skillShInstalls[entry.name];
          skills.push({
            id: skillSh ? this.toSkillShId(skillSh.sourceRef, skillSh.skillShPath) : entry.name,
            installId: skillSh ? entry.name : undefined,
            displayName: frontmatter.name || entry.name,
            description: frontmatter.description || skillSh?.sourceRef || '',
            source: skillSh ? 'skillssh' : 'local',
            sourceRef: skillSh?.sourceRef,
            catalogSkillId: skillSh?.catalogSkillId,
            skillShPath: skillSh?.skillShPath,
            sourceUrl: skillSh
              ? this.getSkillShUrl(skillSh.sourceRef, skillSh.skillShPath)
              : undefined,
            iconUrl: skillSh ? this.getSkillShIconUrl(skillSh.sourceRef) : undefined,
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
    const skill =
      catalog.skills.find((s) => s.id === skillId) ?? (await this.resolveSkillShId(skillId));
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
          const content = await this.fetchSkillShContent(skill);
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
    const skill =
      catalog.skills.find((s) => s.id === skillId) ?? (await this.resolveSkillShId(skillId));
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
      for (const candidateName of this.getInstallNameCandidates(skill)) {
        try {
          await fs.promises.access(path.resolve(SKILLS_ROOT, candidateName));
          throw new Error(`Skill "${candidateName}" is already installed`);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
      }

      await fs.promises.mkdir(tmpDir, { recursive: true });

      // Try to download the real SKILL.md from GitHub; fall back to generated stub
      let content: string;
      if (skill.source === 'skillssh') {
        content = await this.fetchSkillShContent(skill);
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

      // Persist Skills.SH provenance so the installed skill keeps its source + icon
      if (skill.source === 'skillssh' && skill.sourceRef && skill.catalogSkillId) {
        await this.writeSkillShInstall(installName, {
          sourceRef: skill.sourceRef,
          catalogSkillId: skill.catalogSkillId,
          skillShPath: skill.skillShPath ?? skill.catalogSkillId,
        });
      }

      // Invalidate cache
      this.catalogCache = null;
      this.skillShSearchCache.clear();
      this.skillShSkillCache.clear();

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
    const installName = await this.getInstallNameForUninstall(skillId);
    if (!isValidSkillName(installName)) {
      throw new Error(`Invalid skill install name "${installName}"`);
    }
    const skillDir = path.resolve(SKILLS_ROOT, installName);
    if (!this.isPathInsideSkillsRoot(skillDir)) {
      throw new Error(`Invalid skill install path for "${installName}"`);
    }

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

    // Drop any persisted Skills.SH provenance for this install
    await this.removeSkillShInstall(installName);

    // Invalidate cache
    this.catalogCache = null;
    this.skillShSearchCache.clear();
    this.skillShSkillCache.clear();
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

  async searchSkillSh(query: string): Promise<CatalogSkill[]> {
    const trimmed = this.normalizeSkillShSearchQuery(query);
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
        if (entry.isDuplicate) continue;
        if (!this.isSkillShGithubSource(entry.source)) continue;
        if (skills.length >= 24) break;

        const skillShPath = this.normalizeSkillShPath(entry.skillId);
        if (!this.isSafeSkillShPath(skillShPath)) continue;
        const catalogSkillId = this.normalizeSkillShSkillId(skillShPath);
        if (!catalogSkillId) continue;
        const skillId = this.toSkillShId(entry.source, skillShPath);
        if (skills.some((skill) => skill.id === skillId)) continue;
        const displayName = entry.name || catalogSkillId;
        const description = entry.source;
        const sourceUrl = this.getSkillShUrl(entry.source, skillShPath);

        const skill: CatalogSkill = {
          id: skillId,
          installId: this.getSkillShInstallName(entry.source, skillShPath),
          displayName,
          description,
          source: 'skillssh',
          sourceRef: entry.source,
          sourceUrl,
          catalogSkillId,
          skillShPath,
          installs: entry.installs,
          iconUrl: this.getSkillShIconUrl(entry.source),
          brandColor: '#000000',
          frontmatter: { name: catalogSkillId, description },
          installed: false,
        };
        skills.push(skill);
      }

      const mergedSkills = (
        await this.mergeInstalledState({
          version: SkillsService.CATALOG_VERSION,
          lastUpdated: new Date().toISOString(),
          skills,
        })
      ).skills;

      this.skillShSearchCache.set(trimmed, {
        expiresAt: Date.now() + SKILLSH_SEARCH_CACHE_TTL_MS,
        skills: mergedSkills,
      });
      for (const skill of mergedSkills) {
        this.setSkillShSkillCache(skill.id, skill);
      }
      return mergedSkills;
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

  private toSkillShId(sourceRef: string, skillPath: string): string {
    return `skillssh:${sourceRef}/${this.normalizeSkillShPath(skillPath)}`;
  }

  private normalizeSkillShSearchQuery(query: string): string {
    const trimmed = query.trim();
    if (!trimmed) return '';

    try {
      const url = new URL(trimmed);
      const hostname = url.hostname.toLowerCase();
      if (hostname === 'skills.sh' || hostname === 'www.skills.sh') {
        const parts = url.pathname.split('/').filter(Boolean);
        return parts.at(-1) ?? '';
      }
    } catch {
      // Not a URL; use the plain search query.
    }

    return trimmed.toLowerCase();
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

  private setSkillShSkillCache(skillId: string, skill: CatalogSkill): void {
    if (this.skillShSkillCache.has(skillId)) {
      this.skillShSkillCache.delete(skillId);
    }
    this.skillShSkillCache.set(skillId, skill);
    while (this.skillShSkillCache.size > SKILLSH_SKILL_CACHE_MAX_ENTRIES) {
      const oldestKey = this.skillShSkillCache.keys().next().value;
      if (!oldestKey) break;
      this.skillShSkillCache.delete(oldestKey);
    }
  }

  private async resolveSkillShId(skillId: string): Promise<CatalogSkill | null> {
    const cached = this.parseSkillShId(skillId);
    if (cached) return cached;
    if (!skillId.startsWith('skillssh:')) return null;

    const parsed = this.parseSkillShRemoteId(skillId);
    if (!parsed) return null;

    const sourceUrl = this.getSkillShUrl(parsed.sourceRef, parsed.skillShPath);
    const pageDescription = await this.fetchSkillShPageDescription(sourceUrl).catch(() => null);

    const skill: CatalogSkill = {
      id: skillId,
      installId: this.getSkillShInstallName(parsed.sourceRef, parsed.skillShPath),
      displayName: parsed.catalogSkillId,
      description: `${parsed.sourceRef}`,
      source: 'skillssh',
      sourceRef: parsed.sourceRef,
      sourceUrl,
      catalogSkillId: parsed.catalogSkillId,
      skillShPath: parsed.skillShPath,
      iconUrl: this.getSkillShIconUrl(parsed.sourceRef),
      brandColor: '#000000',
      frontmatter: {
        name: parsed.catalogSkillId,
        description: pageDescription ?? parsed.sourceRef,
      },
      installed: false,
    };
    this.setSkillShSkillCache(skill.id, skill);
    return skill;
  }

  private getInstallName(skill: CatalogSkill): string {
    return this.getInstallNameCandidates(skill)[0] ?? skill.id;
  }

  private getInstallNameCandidates(skill: CatalogSkill): string[] {
    if (skill.source !== 'skillssh' || !skill.sourceRef || !skill.catalogSkillId) return [skill.id];

    const installNames = [
      skill.installId ??
        this.getSkillShInstallName(skill.sourceRef, skill.skillShPath ?? skill.catalogSkillId),
    ];
    const legacyInstallName = this.getLegacySkillShInstallName(
      skill.sourceRef,
      skill.catalogSkillId
    );
    if (legacyInstallName && !installNames.includes(legacyInstallName)) {
      installNames.push(legacyInstallName);
    }
    return installNames;
  }

  private async getInstallNameForUninstall(skillId: string): Promise<string> {
    const cachedSkill = this.parseSkillShId(skillId);
    if (cachedSkill) return this.getExistingInstallName(cachedSkill);
    if (!skillId.startsWith('skillssh:')) return skillId;

    const parsed = this.parseSkillShRemoteId(skillId);
    if (!parsed) {
      throw new Error(`Invalid Skills.SH skill id "${skillId}"`);
    }
    return this.getExistingInstallName({
      id: skillId,
      displayName: parsed.catalogSkillId,
      description: parsed.sourceRef,
      source: 'skillssh',
      sourceRef: parsed.sourceRef,
      catalogSkillId: parsed.catalogSkillId,
      skillShPath: parsed.skillShPath,
      frontmatter: { name: parsed.catalogSkillId, description: parsed.sourceRef },
      installed: false,
    });
  }

  private async getExistingInstallName(skill: CatalogSkill): Promise<string> {
    const installNames = this.getInstallNameCandidates(skill);
    for (const installName of installNames) {
      try {
        await fs.promises.access(path.resolve(SKILLS_ROOT, installName));
        return installName;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return installNames[0] ?? skill.id;
  }

  private parseSkillShRemoteId(
    skillId: string
  ): { sourceRef: string; catalogSkillId: string; skillShPath: string } | null {
    const fullId = skillId.slice('skillssh:'.length);
    const parts = fullId.split('/');
    if (parts.length < 3) return null;

    const sourceRef = parts.slice(0, 2).join('/');
    if (!this.isSkillShGithubSource(sourceRef)) return null;

    const skillShPath = this.normalizeSkillShPath(parts.slice(2).join('/'));
    if (!this.isSafeSkillShPath(skillShPath)) return null;
    const catalogSkillId = this.normalizeSkillShSkillId(skillShPath);
    if (!catalogSkillId) return null;
    return { sourceRef, catalogSkillId, skillShPath };
  }

  private getSkillShInstallName(sourceRef: string, skillPath: string): string {
    const sourceSlug = this.toSkillNameSlug(sourceRef.replace(/\//g, '-'));
    const normalizedSkillPath = this.normalizeSkillShPath(skillPath);
    const skillSlug = this.toSkillNameSlug(normalizedSkillPath);
    const hash = createHash('sha256')
      .update(`${sourceRef}/${normalizedSkillPath}`)
      .digest('hex')
      .slice(0, 8);
    const base = `skillssh-${sourceSlug}-${skillSlug}`;

    const maxBaseLength = MAX_SKILL_NAME_LENGTH - hash.length - 1;
    const truncatedBase = base.slice(0, maxBaseLength).replace(/-+$/g, '') || 'skillssh';
    return `${truncatedBase}-${hash}`;
  }

  private async readSkillShInstalls(): Promise<Record<string, SkillShInstallRecord>> {
    try {
      const data = await fs.promises.readFile(SKILLSH_INSTALLS_PATH, 'utf-8');
      const parsed = JSON.parse(data) as Record<string, SkillShInstallRecord>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private async writeSkillShInstall(
    installName: string,
    record: SkillShInstallRecord
  ): Promise<void> {
    const installs = await this.readSkillShInstalls();
    installs[installName] = record;
    await fs.promises.mkdir(EMDASH_META, { recursive: true });
    await fs.promises.writeFile(SKILLSH_INSTALLS_PATH, JSON.stringify(installs, null, 2));
  }

  private async removeSkillShInstall(installName: string): Promise<void> {
    const installs = await this.readSkillShInstalls();
    if (!(installName in installs)) return;
    delete installs[installName];
    await fs.promises.writeFile(SKILLSH_INSTALLS_PATH, JSON.stringify(installs, null, 2));
  }

  /**
   * Read the provenance index, dropping entries whose install directory no
   * longer exists (e.g. deleted outside the app). Existence is checked against
   * the real directory — never the SKILL.md parse — so a transient read error
   * can never discard provenance. Writes back only when something was pruned.
   */
  private async readPrunedSkillShInstalls(): Promise<Record<string, SkillShInstallRecord>> {
    const installs = await this.readSkillShInstalls();
    const live: Record<string, SkillShInstallRecord> = {};
    let pruned = false;
    for (const [installName, record] of Object.entries(installs)) {
      try {
        await fs.promises.access(path.resolve(SKILLS_ROOT, installName));
        live[installName] = record;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          pruned = true;
        } else {
          // Unknown error (e.g. permissions) — keep the entry to stay safe
          live[installName] = record;
        }
      }
    }
    if (pruned) {
      await fs.promises.writeFile(SKILLSH_INSTALLS_PATH, JSON.stringify(live, null, 2));
    }
    return live;
  }

  private getLegacySkillShInstallName(sourceRef: string, catalogSkillId: string): string | null {
    const [owner, repo] = sourceRef.split('/');
    const installName = `skillssh-${owner}-${repo}-${this.normalizeSkillShSkillId(catalogSkillId)}`;
    return isValidSkillName(installName) ? installName : null;
  }

  private toSkillNameSlug(value: string): string {
    return (
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'skill'
    );
  }

  private getSkillShUrl(sourceRef: string, skillPath: string): string {
    const encodedSkillPath = this.normalizeSkillShPath(skillPath)
      .split('/')
      .map(encodeURIComponent)
      .join('/');
    return `https://skills.sh/${sourceRef}/${encodedSkillPath}`;
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
    if (!this.isSafeSkillShPath(skill.skillShPath)) {
      throw new Error(
        `Invalid Skills.SH skill path for ${skill.sourceRef}/${skill.catalogSkillId}`
      );
    }

    const candidatePaths = [`${skill.skillShPath}/SKILL.md`];
    if (!skill.skillShPath.startsWith('skills/')) {
      candidatePaths.push(`skills/${skill.skillShPath}/SKILL.md`);
    }

    for (const skillMdPath of candidatePaths) {
      const encodedPath = skillMdPath.split('/').map(encodeURIComponent).join('/');
      try {
        return await httpsGet(
          `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${encodedPath}`
        );
      } catch (error) {
        if (!(error instanceof HttpStatusError) || error.statusCode !== 404) throw error;
      }
    }

    const treePath = await this.findSkillShSkillMdPath(owner, repo, skill.skillShPath);
    if (treePath) {
      const encodedPath = treePath.split('/').map(encodeURIComponent).join('/');
      return httpsGet(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${encodedPath}`);
    }

    throw new Error(`Could not fetch SKILL.md for ${skill.sourceRef}/${skill.catalogSkillId}`);
  }

  private async findSkillShSkillMdPath(
    owner: string,
    repo: string,
    skillPath: string
  ): Promise<string | null> {
    const treeData = await httpsGet(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`
    );
    const tree = JSON.parse(treeData) as { tree?: Array<{ path: string; type: string }> };
    const candidates =
      tree.tree?.filter((entry) => {
        if (entry.type !== 'blob') return false;
        if (entry.path === `${skillPath}/SKILL.md`) return true;
        if (entry.path.endsWith(`/skills/${skillPath}/SKILL.md`)) return true;
        return entry.path.endsWith(`/${skillPath}/SKILL.md`);
      }) ?? [];

    return candidates[0]?.path ?? null;
  }

  private async fetchSkillShContent(skill: CatalogSkill): Promise<string> {
    try {
      return await this.fetchSkillShSkillMd(skill);
    } catch (error) {
      log.warn(`Failed to fetch Skills.SH SKILL.md for ${skill.id}, using page metadata`, error);
      const description = await this.fetchSkillShDescription(skill).catch(() => skill.description);
      return generateSkillMd(skill.displayName, description);
    }
  }

  private async fetchSkillShDescription(skill: CatalogSkill): Promise<string> {
    if (!skill.sourceUrl) return skill.description;

    return this.fetchSkillShPageDescription(skill.sourceUrl);
  }

  private async fetchSkillShPageDescription(sourceUrl: string): Promise<string> {
    const html = await httpsGet(sourceUrl);
    const description =
      this.extractHtmlMetaContent(html, 'description') ??
      this.extractHtmlMetaContent(html, 'og:description') ??
      '';
    return this.decodeHtmlEntities(description).trim();
  }

  private extractHtmlMetaContent(html: string, name: string): string | null {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match either attribute order: name/property before content, or content first.
    const nameBeforeContent = new RegExp(
      `<meta[^>]+(?:name|property)=["']${escapedName}["'][^>]+content=["']([^"']*)["']`,
      'i'
    );
    const contentBeforeName = new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escapedName}["']`,
      'i'
    );
    return html.match(nameBeforeContent)?.[1] ?? html.match(contentBeforeName)?.[1] ?? null;
  }

  private decodeHtmlEntities(value: string): string {
    return value
      .replace(/&quot;/g, '"')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  private isPathInsideSkillsRoot(candidatePath: string): boolean {
    const relativePath = path.relative(SKILLS_ROOT, candidatePath);
    return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
  }

  private isSafeSkillShPath(skillPath: string): boolean {
    if (!skillPath || path.posix.isAbsolute(skillPath)) return false;
    return !skillPath.split('/').some((part) => !part || part === '.' || part === '..');
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

    const mergedSkills: CatalogSkill[] = dedupedSkills.map((skill) => {
      const installNames = this.getInstallNameCandidates(skill);
      const installName = installNames[0] ?? skill.id;
      const local =
        installedMap.get(skill.id) ??
        installNames.map((name) => installedMap.get(name)).find(Boolean);
      if (local) {
        installedMap.delete(local.id);
        return {
          ...skill,
          installId: installName !== skill.id ? installName : skill.installId,
          displayName: local.displayName || skill.displayName,
          description: local.description || skill.description,
          frontmatter: { ...skill.frontmatter, ...local.frontmatter },
          installed: true,
          localPath: local.localPath,
          skillMdContent: local.skillMdContent,
        };
      }
      return {
        ...skill,
        installId: installName !== skill.id ? installName : skill.installId,
        installed: false,
      };
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
