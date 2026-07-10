import type { PluginFs } from '@emdash/core/agents/plugins';
import {
  EMDASH_SKILLS_DIR,
  generateSkillMd,
  getAvailableSkillMirrorDirs,
  isValidSkillName,
  mirrorSkill,
  parseFrontmatter,
  removeAllSkillMirrors,
  skillEntryExists,
  type CatalogSkill,
  USER_SKILLS_DIRS,
} from '@emdash/core/skills';
import type { AgentConfigSkillsError } from '@emdash/core/workspace-server';
import { err, ok, type Result } from '@emdash/shared';
import type { AgentConfigSkillsModel } from '../state/live-models';
import { publishLiveModelState } from '../state/live-models';
import type { AgentConfigRuntimeDeps } from './types';

const SKILLS_ROOT = EMDASH_SKILLS_DIR;
const EMDASH_META = `${SKILLS_ROOT}/.emdash`;
const SKILLSH_INSTALLS_PATH = `${EMDASH_META}/skillssh-installs.json`;

type SkillInstallPayload = {
  id: string;
  installId?: string;
  skillMdContent: string;
  source?: CatalogSkill['source'];
  sourceRef?: string;
  catalogSkillId?: string;
  skillShPath?: string;
  iconUrl?: string;
};

type SkillShInstallRecord = {
  sourceRef: string;
  catalogSkillId: string;
  skillShPath: string;
};

export class AgentSkillsManager {
  private list: CatalogSkill[] = [];

  constructor(
    private readonly deps: AgentConfigRuntimeDeps,
    private readonly model: AgentConfigSkillsModel
  ) {}

  async initialize(): Promise<void> {
    await this.syncCanonicalSkillsToAgents();
    await this.refresh();
  }

  async refresh(): Promise<CatalogSkill[]> {
    const installed = await getInstalledSkills(this.deps.pluginFs, this.deps.homeDir);
    this.publish(installed);
    return installed;
  }

  async installSkill(
    payload: SkillInstallPayload
  ): Promise<Result<CatalogSkill[], AgentConfigSkillsError>> {
    const installId = payload.installId ?? payload.id;
    if (!isValidSkillName(installId)) {
      return err({ type: 'invalid-state', message: `Invalid skill name: "${installId}"` });
    }
    const { frontmatter } = parseFrontmatter(payload.skillMdContent);
    try {
      if (
        await skillEntryExists(
          this.deps.pluginFs,
          [installId, payload.id, frontmatter.name].filter(isValidSkillName)
        )
      ) {
        return err({ type: 'invalid-state', message: `Skill "${payload.id}" already exists` });
      }
      await this.deps.pluginFs.write(
        `${SKILLS_ROOT}/${installId}/SKILL.md`,
        payload.skillMdContent
      );
      if (
        payload.source === 'skillssh' &&
        payload.sourceRef &&
        payload.catalogSkillId &&
        payload.skillShPath
      ) {
        const installs = await readSkillShInstalls(this.deps.pluginFs);
        installs[installId] = {
          sourceRef: payload.sourceRef,
          catalogSkillId: payload.catalogSkillId,
          skillShPath: payload.skillShPath,
        };
        await writeSkillShInstalls(this.deps.pluginFs, installs);
      }
      await this.mirrorSkillToAgents(
        installId,
        frontmatter.name || installId,
        payload.skillMdContent
      );
      return ok(await this.refresh());
    } catch (error) {
      return err(toIoError(error));
    }
  }

  async removeSkill(name: string): Promise<Result<CatalogSkill[], AgentConfigSkillsError>> {
    if (!isValidSkillName(name)) {
      return err({ type: 'invalid-state', message: `Invalid skill name: "${name}"` });
    }
    try {
      const content = await this.deps.pluginFs.read(`${SKILLS_ROOT}/${name}/SKILL.md`);
      if (!content) {
        return err({
          type: 'invalid-state',
          message: `Skill "${name}" was installed outside Emdash and cannot be removed here`,
        });
      }
      const { frontmatter } = parseFrontmatter(content);
      await this.removeSkillMirrorsFromAgents(name, frontmatter.name || name);
      await this.deps.pluginFs.delete(`${SKILLS_ROOT}/${name}`);
      const installs = await readSkillShInstalls(this.deps.pluginFs);
      if (installs[name]) {
        delete installs[name];
        await writeSkillShInstalls(this.deps.pluginFs, installs);
      }
      return ok(await this.refresh());
    } catch (error) {
      return err(toIoError(error));
    }
  }

  async createSkill(input: {
    name: string;
    description: string;
    content?: string;
  }): Promise<Result<CatalogSkill[], AgentConfigSkillsError>> {
    if (!isValidSkillName(input.name)) {
      return err({ type: 'invalid-state', message: `Invalid skill name: "${input.name}"` });
    }
    try {
      if (await skillEntryExists(this.deps.pluginFs, [input.name])) {
        return err({ type: 'invalid-state', message: `Skill "${input.name}" already exists` });
      }
      const skillContent = generateSkillMd(input.name, input.description, input.content);
      await this.deps.pluginFs.write(`${SKILLS_ROOT}/${input.name}/SKILL.md`, skillContent);
      await this.mirrorSkillToAgents(input.name, input.name, skillContent);
      return ok(await this.refresh());
    } catch (error) {
      return err(toIoError(error));
    }
  }

  private publish(list: CatalogSkill[]): void {
    const previous = this.list;
    this.list = list;
    publishLiveModelState(this.model.states.list, list, previous);
  }

  private async syncCanonicalSkillsToAgents(): Promise<void> {
    const availableMirrorDirs = await getAvailableSkillMirrorDirs(this.deps.pluginFs);
    for (const installName of await this.deps.pluginFs.list(SKILLS_ROOT)) {
      if (installName === '.emdash') continue;
      const content = await this.deps.pluginFs.read(`${SKILLS_ROOT}/${installName}/SKILL.md`);
      if (!content) continue;
      const { frontmatter } = parseFrontmatter(content);
      await this.mirrorSkillToAgents(
        installName,
        frontmatter.name || installName,
        content,
        availableMirrorDirs
      );
    }
  }

  private async mirrorSkillToAgents(
    installName: string,
    frontmatterName: string,
    content: string,
    relativeDirs?: string[]
  ): Promise<void> {
    const targets = relativeDirs ?? (await getAvailableSkillMirrorDirs(this.deps.pluginFs));
    await Promise.all(
      targets.map(async (relativeDir) => {
        try {
          await mirrorSkill(this.deps.pluginFs, {
            relativeDir,
            installName,
            frontmatterName,
            content,
            canonicalPath: `${this.deps.homeDir}/${SKILLS_ROOT}/${installName}`,
            canonicalRoot: `${this.deps.homeDir}/${SKILLS_ROOT}`,
          });
        } catch (error) {
          this.deps.logger.warn(`Failed to mirror skill "${installName}" to ${relativeDir}`, {
            error,
          });
        }
      })
    );
  }

  private async removeSkillMirrorsFromAgents(
    installName: string,
    frontmatterName: string
  ): Promise<void> {
    await removeAllSkillMirrors(this.deps.pluginFs, {
      installName,
      frontmatterName,
      canonicalRoot: `${this.deps.homeDir}/${SKILLS_ROOT}`,
    });
  }
}

function toIoError(error: unknown): AgentConfigSkillsError {
  return { type: 'io', message: error instanceof Error ? error.message : String(error) };
}

async function getInstalledSkills(fs: PluginFs, homeDir: string): Promise<CatalogSkill[]> {
  const provenance = await readSkillShInstalls(fs);
  const seen = new Set<string>();
  const seenSkillNames = new Set<string>();
  const skills: CatalogSkill[] = [];
  for (const skillsDir of USER_SKILLS_DIRS) {
    const entries = await fs.list(skillsDir);
    for (const entry of entries) {
      if (entry === '.emdash' || seen.has(entry)) continue;
      const content = await fs.read(`${skillsDir}/${entry}/SKILL.md`);
      if (!content) continue;
      const parsed = parseFrontmatter(content);
      const record = skillsDir === SKILLS_ROOT ? provenance[entry] : undefined;
      const skillName = (parsed.frontmatter.name || record?.catalogSkillId || entry).toLowerCase();
      if (seenSkillNames.has(skillName)) continue;
      seen.add(entry);
      seenSkillNames.add(skillName);
      skills.push({
        id: record?.catalogSkillId ?? entry,
        installId: entry,
        displayName: parsed.frontmatter.name || entry,
        description: parsed.frontmatter.description || '',
        source: record ? 'skillssh' : 'local',
        sourceRef: record?.sourceRef,
        catalogSkillId: record?.catalogSkillId,
        skillShPath: record?.skillShPath,
        skillMdContent: content,
        frontmatter: parsed.frontmatter,
        installed: true,
        managedByEmdash: skillsDir === SKILLS_ROOT,
        localPath: `${homeDir}/${skillsDir}/${entry}`,
      });
    }
  }
  return skills;
}

async function readSkillShInstalls(fs: PluginFs): Promise<Record<string, SkillShInstallRecord>> {
  const raw = await fs.read(SKILLSH_INSTALLS_PATH);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, SkillShInstallRecord>;
  } catch {
    return {};
  }
}

async function writeSkillShInstalls(
  fs: PluginFs,
  records: Record<string, SkillShInstallRecord>
): Promise<void> {
  await fs.write(SKILLSH_INSTALLS_PATH, JSON.stringify(records, null, 2));
}
