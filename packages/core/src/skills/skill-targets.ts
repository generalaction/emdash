import type { PluginFs } from '../agents/runtime/fs';
import { skillTargetSelectionSchema } from './schemas';
import type { SkillTargetSelection } from './types';

const TARGETS_PATH = '.agentskills/.emdash/skill-targets.json';
const TARGETS_DIR = '.agentskills/.emdash/skill-targets';

type SkillTargetsFile = {
  version: 1;
  skills: Record<string, SkillTargetSelection>;
};

type SkillTargetFile =
  | { version: 1; targets: SkillTargetSelection }
  | { version: 1; deleted: true };

function targetPath(installName: string): string {
  return `${TARGETS_DIR}/${encodeURIComponent(installName)}.json`;
}

async function readTargetsFile(fs: PluginFs): Promise<SkillTargetsFile> {
  const raw = await fs.read(TARGETS_PATH);
  if (!raw) return { version: 1, skills: {} };
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; skills?: unknown };
    if (parsed.version !== 1 || !parsed.skills || typeof parsed.skills !== 'object') {
      return { version: 1, skills: {} };
    }
    const skills: Record<string, SkillTargetSelection> = {};
    for (const [name, selection] of Object.entries(parsed.skills)) {
      const result = skillTargetSelectionSchema.safeParse(selection);
      if (result.success) skills[name] = result.data;
    }
    return { version: 1, skills };
  } catch {
    return { version: 1, skills: {} };
  }
}

async function readSkillTargetFile(
  fs: PluginFs,
  installName: string
): Promise<SkillTargetSelection | null | undefined> {
  const raw = await fs.read(targetPath(installName));
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; targets?: unknown; deleted?: unknown };
    if (parsed.version !== 1) return undefined;
    if (parsed.deleted === true) return null;
    const result = skillTargetSelectionSchema.safeParse(parsed.targets);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export async function getSkillTargets(
  fs: PluginFs,
  installName: string
): Promise<SkillTargetSelection> {
  const targets = await readSkillTargetFile(fs, installName);
  if (targets !== undefined) return targets ?? { mode: 'all' };
  return (await readTargetsFile(fs)).skills[installName] ?? { mode: 'all' };
}

export async function setSkillTargets(
  fs: PluginFs,
  installName: string,
  targets: SkillTargetSelection
): Promise<void> {
  const file: SkillTargetFile = { version: 1, targets };
  await fs.write(targetPath(installName), `${JSON.stringify(file, null, 2)}\n`);
}

export async function removeSkillTargets(fs: PluginFs, installName: string): Promise<void> {
  const file: SkillTargetFile = { version: 1, deleted: true };
  await fs.write(targetPath(installName), `${JSON.stringify(file, null, 2)}\n`);
}
