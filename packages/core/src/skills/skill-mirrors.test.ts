import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalPluginFs } from '../agents/plugins/helpers/local-plugin-fs';
import { mirrorSkill, removeSkillMirrors, skillEntryExists } from './skill-mirrors';
import { getSkillTargets, removeSkillTargets, setSkillTargets } from './skill-targets';

const content = '---\nname: reviewer\ndescription: Review changes\n---\n';

describe('skill mirrors', () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'emdash-skill-mirror-'));
  });

  afterEach(async () => {
    await fs.promises.rm(homeDir, { recursive: true, force: true });
  });

  it('creates and removes a symlink to the canonical skill', async () => {
    const pluginFs = createLocalPluginFs(homeDir);
    const canonicalPath = path.join(homeDir, '.agentskills/reviewer');
    await pluginFs.write('.agentskills/reviewer/SKILL.md', content);
    const createSymlink = pluginFs.symlink;
    pluginFs.symlink = vi.fn((target, linkPath) => createSymlink!(target, linkPath));

    const mirrored = await mirrorSkill(pluginFs, {
      relativeDir: '.claude/skills',
      installName: 'reviewer',
      frontmatterName: 'reviewer',
      content,
      canonicalPath,
    });
    await mirrorSkill(pluginFs, {
      relativeDir: '.claude/skills',
      installName: 'reviewer',
      frontmatterName: 'reviewer',
      content,
      canonicalPath,
    });

    expect(mirrored).toBe('reviewer');
    expect(pluginFs.symlink).toHaveBeenCalledTimes(1);
    expect(await pluginFs.readLink?.('.claude/skills/reviewer')).toBe(canonicalPath);

    await removeSkillMirrors(pluginFs, {
      relativeDir: '.claude/skills',
      installName: 'reviewer',
      frontmatterName: 'reviewer',
      canonicalRoot: path.join(homeDir, '.agentskills'),
    });
    expect(await pluginFs.readLink?.('.claude/skills/reviewer')).toBeNull();
  });

  it('never overwrites or removes an unmanaged skill directory', async () => {
    const pluginFs = createLocalPluginFs(homeDir);
    await pluginFs.write('.claude/skills/reviewer/SKILL.md', 'unmanaged');

    const mirrored = await mirrorSkill(pluginFs, {
      relativeDir: '.claude/skills',
      installName: 'reviewer',
      frontmatterName: 'reviewer',
      content,
      canonicalPath: path.join(homeDir, '.agentskills/reviewer'),
    });
    await removeSkillMirrors(pluginFs, {
      relativeDir: '.claude/skills',
      installName: 'reviewer',
      frontmatterName: 'reviewer',
      canonicalRoot: path.join(homeDir, '.agentskills'),
    });

    expect(mirrored).toBeNull();
    expect(await pluginFs.read('.claude/skills/reviewer/SKILL.md')).toBe('unmanaged');
  });

  it('does not remove a mirror owned by another canonical skill', async () => {
    const pluginFs = createLocalPluginFs(homeDir);
    const otherCanonicalPath = path.join(homeDir, '.agentskills/other-reviewer');
    await pluginFs.write('.agentskills/other-reviewer/SKILL.md', content);
    await pluginFs.symlink?.(otherCanonicalPath, '.claude/skills/reviewer');

    const mirrored = await mirrorSkill(pluginFs, {
      relativeDir: '.claude/skills',
      installName: 'reviewer',
      frontmatterName: 'reviewer',
      content,
      canonicalPath: path.join(homeDir, '.agentskills/reviewer'),
    });
    await removeSkillMirrors(pluginFs, {
      relativeDir: '.claude/skills',
      installName: 'reviewer',
      frontmatterName: 'reviewer',
      canonicalRoot: path.join(homeDir, '.agentskills'),
    });

    expect(mirrored).toBeNull();
    expect(await pluginFs.readLink?.('.claude/skills/reviewer')).toBe(otherCanonicalPath);
  });

  it('uses an ownership-marked copy when requested', async () => {
    const pluginFs = createLocalPluginFs(homeDir);

    await mirrorSkill(pluginFs, {
      relativeDir: '.claude/skills',
      installName: 'reviewer',
      frontmatterName: 'reviewer',
      content,
      canonicalPath: path.join(homeDir, '.agentskills/reviewer'),
      mode: 'copy',
    });

    expect(await pluginFs.read('.claude/skills/reviewer/SKILL.md')).toBe(content);
    expect(await pluginFs.read('.claude/skills/reviewer/.emdash-managed.json')).toContain(
      '"managedBy": "emdash"'
    );

    await removeSkillMirrors(pluginFs, {
      relativeDir: '.claude/skills',
      installName: 'reviewer',
      frontmatterName: 'reviewer',
      canonicalRoot: path.join(homeDir, '.agentskills'),
    });
    expect(await pluginFs.read('.claude/skills/reviewer/SKILL.md')).toBeNull();
  });

  it('does not copy over an unmanaged entry created after the ownership check', async () => {
    const pluginFs = createLocalPluginFs(homeDir);
    const canonicalPath = path.join(homeDir, '.agentskills/reviewer');
    await pluginFs.write('.agentskills/reviewer/SKILL.md', content);
    pluginFs.symlink = vi.fn(async () => {
      await pluginFs.write('.claude/skills/reviewer/SKILL.md', 'unmanaged');
      throw new Error('EEXIST');
    });

    const mirrored = await mirrorSkill(pluginFs, {
      relativeDir: '.claude/skills',
      installName: 'reviewer',
      frontmatterName: 'reviewer',
      content,
      canonicalPath,
    });

    expect(mirrored).toBeNull();
    expect(await pluginFs.read('.claude/skills/reviewer/SKILL.md')).toBe('unmanaged');
    expect(await pluginFs.read('.claude/skills/reviewer/.emdash-managed.json')).toBeNull();
  });

  it('finds an existing skill by its frontmatter name', async () => {
    const pluginFs = createLocalPluginFs(homeDir);
    await pluginFs.write('.claude/skills/custom-directory/SKILL.md', content);

    await expect(skillEntryExists(pluginFs, ['reviewer'])).resolves.toBe(true);
  });

  it('persists and removes per-skill sync targets', async () => {
    const pluginFs = createLocalPluginFs(homeDir);

    await expect(getSkillTargets(pluginFs, 'reviewer')).resolves.toEqual({ mode: 'all' });
    await setSkillTargets(pluginFs, 'reviewer', {
      mode: 'providers',
      providerIds: ['claude', 'codex'],
    });
    await expect(getSkillTargets(pluginFs, 'reviewer')).resolves.toEqual({
      mode: 'providers',
      providerIds: ['claude', 'codex'],
    });

    await removeSkillTargets(pluginFs, 'reviewer');
    await expect(getSkillTargets(pluginFs, 'reviewer')).resolves.toEqual({ mode: 'all' });

    await pluginFs.write(
      '.agentskills/.emdash/skill-targets.json',
      JSON.stringify({ version: 1, skills: { reviewer: { mode: 'providers' } } })
    );
    await expect(getSkillTargets(pluginFs, 'reviewer')).resolves.toEqual({ mode: 'all' });
  });
});
