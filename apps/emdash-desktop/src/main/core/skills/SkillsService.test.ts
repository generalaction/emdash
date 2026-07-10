import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isValidSkillName } from '@emdash/core/skills';
import { afterEach, describe, expect, it } from 'vitest';
import { SkillsService } from './SkillsService';

type SkillsServiceInternals = {
  getSkillShInstallName(sourceRef: string, skillPath: string): string;
};

describe('SkillsService Skills.SH install names', () => {
  const service = new SkillsService() as unknown as SkillsServiceInternals;

  it('keeps nested Skills.SH paths distinct even when the leaf name matches', () => {
    const first = service.getSkillShInstallName('owner/repo', 'skills/react');
    const second = service.getSkillShInstallName('owner/repo', 'examples/react');

    expect(first).not.toBe(second);
    expect(isValidSkillName(first)).toBe(true);
    expect(isValidSkillName(second)).toBe(true);
  });

  it('keeps owner and repo boundaries distinct when hyphens collide', () => {
    const first = service.getSkillShInstallName('foo-bar/baz', 'qux');
    const second = service.getSkillShInstallName('foo/bar-baz', 'qux');

    expect(first).not.toBe(second);
    expect(isValidSkillName(first)).toBe(true);
    expect(isValidSkillName(second)).toBe(true);
  });

  it('sanitizes uppercase and punctuation in Skills.SH paths', () => {
    const installName = service.getSkillShInstallName('Owner/Repo', 'skills/React:Components');

    expect(installName).toMatch(/^skillssh-owner-repo-skills-react-components-[a-f0-9]{8}$/);
    expect(isValidSkillName(installName)).toBe(true);
  });

  it('truncates long Skills.SH install names to the local skill name limit', () => {
    const installName = service.getSkillShInstallName(
      'very-long-owner-name/very-long-repository-name',
      'skills/very-long-skill-name-that-would-otherwise-exceed-the-sixty-four-character-limit'
    );

    expect(installName.length).toBeLessThanOrEqual(64);
    expect(installName).toMatch(/-[a-f0-9]{8}$/);
    expect(isValidSkillName(installName)).toBe(true);
  });
});

describe('SkillsService uninstall and sync safety', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('rejects non-Skills.SH uninstall ids that are not valid local skill names', async () => {
    const service = new SkillsService();

    await expect(service.uninstallSkill('../outside')).rejects.toThrow(
      'Invalid skill install name'
    );
  });

  it('discovers skills installed in shared and agent-specific user directories', async () => {
    const homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'emdash-skills-'));
    tempDirs.push(homeDir);
    await Promise.all([
      writeSkill(homeDir, '.agents/skills', 'shared-reviewer', 'Shared reviewer'),
      writeSkill(homeDir, '.claude/skills', 'claude-reviewer', 'Claude reviewer'),
      writeSkill(homeDir, '.codex/skills', 'codex-reviewer', 'Codex reviewer'),
      writeSkill(homeDir, '.cursor/skills', 'cursor-reviewer', 'Cursor reviewer'),
    ]);
    const service = new SkillsService({ homeDir });

    const installed = await service.getInstalledSkills();

    expect(installed.map((skill) => skill.id).sort()).toEqual([
      'claude-reviewer',
      'codex-reviewer',
      'cursor-reviewer',
      'shared-reviewer',
    ]);
  });

  it('deduplicates a skill mirrored into multiple agent directories', async () => {
    const homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'emdash-skills-'));
    tempDirs.push(homeDir);
    await Promise.all([
      writeSkill(homeDir, '.agents/skills', 'reviewer', 'Reviewer'),
      writeSkill(homeDir, '.claude/skills', 'reviewer', 'Reviewer'),
      writeSkill(homeDir, '.cursor/skills', 'reviewer', 'Reviewer'),
    ]);
    const service = new SkillsService({ homeDir });

    const installed = await service.getInstalledSkills();

    expect(installed).toHaveLength(1);
    expect(installed[0]?.id).toBe('reviewer');
    expect(installed[0]?.localPath).toBe(
      await fs.promises.realpath(path.join(homeDir, '.agents/skills/reviewer'))
    );
  });

  it('uninstalls a detected skill from every user skill directory', async () => {
    const homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'emdash-skills-'));
    tempDirs.push(homeDir);
    await Promise.all([
      writeSkill(homeDir, '.agents/skills', 'reviewer', 'Reviewer'),
      writeSkill(homeDir, '.claude/skills', 'reviewer', 'Reviewer'),
    ]);
    const service = new SkillsService({ homeDir });

    await service.uninstallSkill('reviewer');

    await expect(
      fs.promises.access(path.join(homeDir, '.agents/skills/reviewer'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      fs.promises.access(path.join(homeDir, '.claude/skills/reviewer'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

async function writeSkill(
  homeDir: string,
  relativeRoot: string,
  name: string,
  description: string
): Promise<void> {
  const skillDir = path.join(homeDir, relativeRoot, name);
  await fs.promises.mkdir(skillDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n`
  );
}
