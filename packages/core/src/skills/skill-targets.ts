import type { PluginFs } from '../agents/runtime/fs';
import { skillTargetSelectionSchema } from './schemas';
import type { SkillTargetSelection } from './types';

const TARGETS_PATH = '.agentskills/.emdash/skill-targets.json';

type SkillTargetsFile = {
  version: 1;
  skills: Record<string, SkillTargetSelection>;
};

let mutationQueue = Promise.resolve();

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

function updateTargetsFile(
  fs: PluginFs,
  update: (file: SkillTargetsFile) => boolean | void
): Promise<void> {
  const operation = mutationQueue.then(async () => {
    const file = await readTargetsFile(fs);
    if (update(file) === false) return;
    await fs.write(TARGETS_PATH, `${JSON.stringify(file, null, 2)}\n`);
  });
  mutationQueue = operation.catch(() => {});
  return operation;
}

export async function getSkillTargets(
  fs: PluginFs,
  installName: string
): Promise<SkillTargetSelection> {
  return (await readTargetsFile(fs)).skills[installName] ?? { mode: 'all' };
}

export async function setSkillTargets(
  fs: PluginFs,
  installName: string,
  targets: SkillTargetSelection
): Promise<void> {
  await updateTargetsFile(fs, (file) => {
    file.skills[installName] = targets;
  });
}

export async function removeSkillTargets(fs: PluginFs, installName: string): Promise<void> {
  await updateTargetsFile(fs, (file) => {
    if (!(installName in file.skills)) return false;
    delete file.skills[installName];
  });
}
