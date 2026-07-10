import type { PluginFs } from '../agents/runtime/fs';
import { AGENT_SKILLS_DIRS, USER_SKILLS_DIRS } from './locations';
import { isValidSkillName, parseFrontmatter } from './validation';

const MANAGED_MARKER = '.emdash-managed.json';

export type SkillMirrorMode = 'symlink' | 'copy';

export type MirrorSkillOptions = {
  relativeDir: string;
  installName: string;
  frontmatterName: string;
  content: string;
  canonicalPath: string;
  mode?: SkillMirrorMode;
};

export type RemoveSkillMirrorOptions = {
  relativeDir: string;
  installName: string;
  frontmatterName: string;
  canonicalRoot: string;
};

function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name}`;
}

function preferredMirrorName(options: { installName: string; frontmatterName: string }): string {
  return isValidSkillName(options.frontmatterName) ? options.frontmatterName : options.installName;
}

function candidateNames(options: { installName: string; frontmatterName: string }): string[] {
  return [...new Set([preferredMirrorName(options), options.installName])];
}

function normalizePath(value: string): string {
  const normalized = value
    .replace(/\\/g, '/')
    .replace(/^\/\/\?\//, '')
    .replace(/\/+$/, '');
  return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
}

async function readLink(fs: PluginFs, path: string): Promise<string | null> {
  if (!fs.readLink) return null;
  return fs.readLink(path);
}

async function isManagedCopy(fs: PluginFs, dirPath: string, installName: string): Promise<boolean> {
  const marker = await fs.read(joinPath(dirPath, MANAGED_MARKER));
  if (!marker) return false;
  try {
    const parsed = JSON.parse(marker) as {
      managedBy?: string;
      installName?: string;
    };
    return parsed.managedBy === 'emdash' && parsed.installName === installName;
  } catch {
    return false;
  }
}

async function removeOwnedEntry(
  fs: PluginFs,
  entryPath: string,
  canonicalPath: string,
  installName: string
): Promise<boolean> {
  const target = await readLink(fs, entryPath);
  if (target !== null) {
    if (normalizePath(target) !== normalizePath(canonicalPath)) return false;
    await fs.delete(entryPath);
    return true;
  }
  if (!(await fs.exists(entryPath))) return true;
  if (!(await isManagedCopy(fs, entryPath, installName))) return false;
  await fs.delete(entryPath);
  return true;
}

async function writeManagedCopy(
  fs: PluginFs,
  mirrorPath: string,
  installName: string,
  content: string
): Promise<void> {
  await fs.write(joinPath(mirrorPath, 'SKILL.md'), content);
  await fs.write(
    joinPath(mirrorPath, MANAGED_MARKER),
    `${JSON.stringify({ managedBy: 'emdash', installName }, null, 2)}\n`
  );
}

export async function mirrorSkill(
  fs: PluginFs,
  options: MirrorSkillOptions
): Promise<string | null> {
  if (!isValidSkillName(options.installName)) return null;
  const mirrorName = preferredMirrorName(options);
  const mirrorPath = joinPath(options.relativeDir, mirrorName);
  const currentTarget = await readLink(fs, mirrorPath);
  if (
    currentTarget !== null &&
    normalizePath(currentTarget) === normalizePath(options.canonicalPath)
  ) {
    return mirrorName;
  }
  if (
    currentTarget === null &&
    (options.mode === 'copy' || !fs.symlink) &&
    (await isManagedCopy(fs, mirrorPath, options.installName)) &&
    (await fs.read(joinPath(mirrorPath, 'SKILL.md'))) === options.content
  ) {
    return mirrorName;
  }
  if (!(await removeOwnedEntry(fs, mirrorPath, options.canonicalPath, options.installName))) {
    return null;
  }

  if (options.mode !== 'copy' && fs.symlink) {
    try {
      await fs.symlink(options.canonicalPath, mirrorPath);
      return mirrorName;
    } catch {
      if (!(await removeOwnedEntry(fs, mirrorPath, options.canonicalPath, options.installName))) {
        return null;
      }
    }
  }

  await writeManagedCopy(fs, mirrorPath, options.installName, options.content);
  return mirrorName;
}

export async function removeSkillMirrors(
  fs: PluginFs,
  options: RemoveSkillMirrorOptions
): Promise<void> {
  if (!isValidSkillName(options.installName)) return;
  const canonicalPath = joinPath(options.canonicalRoot, options.installName);
  for (const name of candidateNames(options)) {
    await removeOwnedEntry(
      fs,
      joinPath(options.relativeDir, name),
      canonicalPath,
      options.installName
    );
  }
}

export async function removeAllSkillMirrors(
  fs: PluginFs,
  options: Omit<RemoveSkillMirrorOptions, 'relativeDir'>
): Promise<void> {
  await Promise.all(
    AGENT_SKILLS_DIRS.map((relativeDir) => removeSkillMirrors(fs, { ...options, relativeDir }))
  );
}

export async function getAvailableSkillMirrorDirs(fs: PluginFs): Promise<string[]> {
  const results = await Promise.all(
    AGENT_SKILLS_DIRS.map(async (relativeDir) => {
      const parentDir = relativeDir.slice(0, relativeDir.lastIndexOf('/'));
      const available =
        (await fs.exists(relativeDir)) || (parentDir.length > 0 && (await fs.exists(parentDir)));
      return { relativeDir, available };
    })
  );
  return results.filter(({ available }) => available).map(({ relativeDir }) => relativeDir);
}

export async function skillEntryExists(fs: PluginFs, candidateNames: string[]): Promise<boolean> {
  const candidateSet = new Set(candidateNames.map((name) => name.toLowerCase()));
  const matches = await Promise.all(
    USER_SKILLS_DIRS.map(async (skillsDir) => {
      const entries = await fs.list(skillsDir);
      for (const entry of entries) {
        if (candidateSet.has(entry.toLowerCase())) return true;
        const content = await fs.read(joinPath(joinPath(skillsDir, entry), 'SKILL.md'));
        if (!content) continue;
        const { frontmatter } = parseFrontmatter(content);
        if (frontmatter.name && candidateSet.has(frontmatter.name.toLowerCase())) return true;
      }
      return false;
    })
  );
  return matches.some(Boolean);
}
