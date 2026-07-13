import type { PluginFs } from '@emdash/core/agents/plugins';
import {
  AGENT_SKILLS_DIRS,
  EMDASH_SKILLS_DIR,
  generateSkillMd,
  getAvailableSkillMirrorDirs,
  getSkillTargets,
  isValidSkillName,
  isManagedSkillEntry,
  mirrorSkill,
  parseFrontmatter,
  removeAllSkillMirrors,
  removeSkillMirrors,
  removeSkillTargets,
  setSkillTargets,
  skillEntryExists,
  type CatalogSkill,
  type SkillLocation,
  type SkillTargetSelection,
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
  targets?: SkillTargetSelection;
};

type SkillShInstallRecord = {
  sourceRef: string;
  catalogSkillId: string;
  skillShPath: string;
};

export class AgentSkillsManager {
  private list: CatalogSkill[] = [];
  private initialization: Promise<void> | null = null;

  constructor(
    private readonly deps: AgentConfigRuntimeDeps,
    private readonly model: AgentConfigSkillsModel
  ) {}

  initialize(): Promise<void> {
    this.initialization ??= this.initializeOnce();
    return this.initialization;
  }

  private async initializeOnce(): Promise<void> {
    await this.syncCanonicalSkillsToAgents();
    await this.refreshNow();
  }

  async refresh(): Promise<CatalogSkill[]> {
    await this.initialize();
    return this.refreshNow();
  }

  private async refreshNow(): Promise<CatalogSkill[]> {
    const installed = await getInstalledSkills(
      this.deps.agentHost.fs,
      this.deps.agentHost.homeDir,
      this.getSkillProvidersByDir()
    );
    this.publish(installed);
    return installed;
  }

  async installSkill(
    payload: SkillInstallPayload
  ): Promise<Result<CatalogSkill[], AgentConfigSkillsError>> {
    await this.initialize();
    const installId = payload.installId ?? payload.id;
    if (!isValidSkillName(installId)) {
      return err({ type: 'invalid-state', message: `Invalid skill name: "${installId}"` });
    }
    const { frontmatter } = parseFrontmatter(payload.skillMdContent);
    try {
      if (
        await skillEntryExists(
          this.deps.agentHost.fs,
          [installId, payload.id, frontmatter.name].filter(isValidSkillName)
        )
      ) {
        return err({ type: 'invalid-state', message: `Skill "${payload.id}" already exists` });
      }
      await this.deps.agentHost.fs.write(
        `${SKILLS_ROOT}/${installId}/SKILL.md`,
        payload.skillMdContent
      );
      if (
        payload.source === 'skillssh' &&
        payload.sourceRef &&
        payload.catalogSkillId &&
        payload.skillShPath
      ) {
        const installs = await readSkillShInstalls(this.deps.agentHost.fs);
        installs[installId] = {
          sourceRef: payload.sourceRef,
          catalogSkillId: payload.catalogSkillId,
          skillShPath: payload.skillShPath,
        };
        await writeSkillShInstalls(this.deps.agentHost.fs, installs);
      }
      const targets = payload.targets ?? { mode: 'all' };
      await setSkillTargets(this.deps.agentHost.fs, installId, targets);
      await this.reconcileSkillMirrors(
        installId,
        frontmatter.name || installId,
        payload.skillMdContent,
        targets
      );
      return ok(await this.refresh());
    } catch (error) {
      return err(toIoError(error));
    }
  }

  async removeSkill(name: string): Promise<Result<CatalogSkill[], AgentConfigSkillsError>> {
    await this.initialize();
    if (!isValidSkillName(name)) {
      return err({ type: 'invalid-state', message: `Invalid skill name: "${name}"` });
    }
    try {
      const content = await this.deps.agentHost.fs.read(`${SKILLS_ROOT}/${name}/SKILL.md`);
      if (!content) {
        return err({
          type: 'invalid-state',
          message: `Skill "${name}" was installed outside Emdash and cannot be removed here`,
        });
      }
      const { frontmatter } = parseFrontmatter(content);
      await this.removeSkillMirrorsFromAgents(name, frontmatter.name || name);
      await this.deps.agentHost.fs.delete(`${SKILLS_ROOT}/${name}`);
      await removeSkillTargets(this.deps.agentHost.fs, name);
      const installs = await readSkillShInstalls(this.deps.agentHost.fs);
      if (installs[name]) {
        delete installs[name];
        await writeSkillShInstalls(this.deps.agentHost.fs, installs);
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
    targets?: SkillTargetSelection;
  }): Promise<Result<CatalogSkill[], AgentConfigSkillsError>> {
    await this.initialize();
    if (!isValidSkillName(input.name)) {
      return err({ type: 'invalid-state', message: `Invalid skill name: "${input.name}"` });
    }
    try {
      if (await skillEntryExists(this.deps.agentHost.fs, [input.name])) {
        return err({ type: 'invalid-state', message: `Skill "${input.name}" already exists` });
      }
      const skillContent = generateSkillMd(input.name, input.description, input.content);
      await this.deps.agentHost.fs.write(`${SKILLS_ROOT}/${input.name}/SKILL.md`, skillContent);
      const targets = input.targets ?? { mode: 'all' };
      await setSkillTargets(this.deps.agentHost.fs, input.name, targets);
      await this.reconcileSkillMirrors(input.name, input.name, skillContent, targets);
      return ok(await this.refresh());
    } catch (error) {
      return err(toIoError(error));
    }
  }

  async setTargets(
    installName: string,
    targets: SkillTargetSelection
  ): Promise<Result<CatalogSkill[], AgentConfigSkillsError>> {
    await this.initialize();
    if (!isValidSkillName(installName)) {
      return err({ type: 'invalid-state', message: `Invalid skill name: "${installName}"` });
    }
    try {
      const content = await this.deps.agentHost.fs.read(`${SKILLS_ROOT}/${installName}/SKILL.md`);
      if (!content) {
        return err({
          type: 'invalid-state',
          message: `Skill "${installName}" is not managed by Emdash`,
        });
      }
      const { frontmatter } = parseFrontmatter(content);
      await setSkillTargets(this.deps.agentHost.fs, installName, targets);
      await this.reconcileSkillMirrors(
        installName,
        frontmatter.name || installName,
        content,
        targets
      );
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
    for (const installName of await this.deps.agentHost.fs.list(SKILLS_ROOT)) {
      if (!isValidSkillName(installName)) continue;
      const content = await this.deps.agentHost.fs.read(`${SKILLS_ROOT}/${installName}/SKILL.md`);
      if (!content) continue;
      const { frontmatter } = parseFrontmatter(content);
      const targets = await getSkillTargets(this.deps.agentHost.fs, installName);
      await this.reconcileSkillMirrors(
        installName,
        frontmatter.name || installName,
        content,
        targets
      );
    }
  }

  private async reconcileSkillMirrors(
    installName: string,
    frontmatterName: string,
    content: string,
    selection: SkillTargetSelection
  ): Promise<void> {
    const targets =
      selection.mode === 'all'
        ? await getAvailableSkillMirrorDirs(this.deps.agentHost.fs)
        : this.getProviderMirrorDirs(selection.providerIds);
    const targetSet = new Set(targets);
    await Promise.all(
      AGENT_SKILLS_DIRS.filter((relativeDir) => !targetSet.has(relativeDir)).map((relativeDir) =>
        removeSkillMirrors(this.deps.agentHost.fs, {
          relativeDir,
          installName,
          frontmatterName,
          canonicalRoot: `${this.deps.agentHost.homeDir}/${SKILLS_ROOT}`,
        })
      )
    );
    await Promise.all(
      targets.map(async (relativeDir) => {
        try {
          await mirrorSkill(this.deps.agentHost.fs, {
            relativeDir,
            installName,
            frontmatterName,
            content,
            canonicalPath: `${this.deps.agentHost.homeDir}/${SKILLS_ROOT}/${installName}`,
          });
        } catch (error) {
          this.deps.logger.warn(`Failed to mirror skill "${installName}" to ${relativeDir}`, {
            error,
          });
        }
      })
    );
  }

  private getSkillProvidersByDir(): Map<string, string[]> {
    const providersByDir = new Map<string, string[]>();
    for (const provider of this.deps.agentHost.getAll()) {
      const capability = provider.capabilities.skills;
      if (capability.kind !== 'supported') continue;
      for (const location of capability.locations) {
        const providers = providersByDir.get(location.relativeDir) ?? [];
        providers.push(provider.metadata.id);
        providersByDir.set(location.relativeDir, providers);
      }
    }
    return providersByDir;
  }

  private getProviderMirrorDirs(providerIds: string[]): string[] {
    const selected = new Set(providerIds);
    return this.deps.agentHost
      .getAll()
      .filter((provider) => selected.has(provider.metadata.id))
      .flatMap((provider) =>
        provider.capabilities.skills.kind === 'supported'
          ? provider.capabilities.skills.locations
              .filter((location) => location.isolation === 'provider')
              .map((location) => location.relativeDir)
          : []
      );
  }

  private async removeSkillMirrorsFromAgents(
    installName: string,
    frontmatterName: string
  ): Promise<void> {
    await removeAllSkillMirrors(this.deps.agentHost.fs, {
      installName,
      frontmatterName,
      canonicalRoot: `${this.deps.agentHost.homeDir}/${SKILLS_ROOT}`,
    });
  }
}

function toIoError(error: unknown): AgentConfigSkillsError {
  return { type: 'io', message: error instanceof Error ? error.message : String(error) };
}

async function getInstalledSkills(
  fs: PluginFs,
  homeDir: string,
  providersByDir: Map<string, string[]>
): Promise<CatalogSkill[]> {
  const provenance = await readSkillShInstalls(fs);
  const skills: CatalogSkill[] = [];
  const skillsByIdentity = new Map<string, CatalogSkill>();
  const canonicalRoot = `${homeDir}/${SKILLS_ROOT}`;
  for (const skillsDir of USER_SKILLS_DIRS) {
    const entries = await fs.list(skillsDir);
    for (const entry of entries) {
      if (entry === '.emdash') continue;
      const content = await fs.read(`${skillsDir}/${entry}/SKILL.md`);
      if (!content) continue;
      const parsed = parseFrontmatter(content);
      const record = skillsDir === SKILLS_ROOT ? provenance[entry] : undefined;
      const skillName = (parsed.frontmatter.name || record?.catalogSkillId || entry).toLowerCase();
      const identity = `${skillName}:${content}`;
      const canonical = skillsDir === SKILLS_ROOT;
      const providerIds = providersByDir.get(skillsDir) ?? [];
      const location: SkillLocation = {
        relativeDir: skillsDir,
        kind: canonical ? 'canonical' : providerIds.length > 0 ? 'provider' : 'shared',
        providerIds,
        ownership:
          canonical || (await isManagedSkillEntry(fs, `${skillsDir}/${entry}`, canonicalRoot))
            ? 'emdash'
            : 'external',
      };
      const existing = skillsByIdentity.get(identity);
      if (existing) {
        existing.locations = [...(existing.locations ?? []), location];
        continue;
      }
      const skill: CatalogSkill = {
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
        locations: [location],
        targets: canonical ? await getSkillTargets(fs, entry) : undefined,
      };
      skillsByIdentity.set(identity, skill);
      skills.push(skill);
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
