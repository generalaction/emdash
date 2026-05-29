import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isValidSkillName } from '@shared/skills/validation';
import { SkillsService } from './SkillsService';

type SkillsServiceInternals = {
  getSkillShInstallName(sourceRef: string, skillPath: string): string;
  removeSyncedAgentSkillLink(targetDir: string): Promise<void>;
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

  it('does not delete real directories when replacing synced agent skill targets', async () => {
    const service = new SkillsService() as unknown as SkillsServiceInternals;
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'emdash-skills-test-'));
    tempDirs.push(root);
    const targetDir = path.join(root, 'agent-skill');
    await fs.promises.mkdir(targetDir);
    await fs.promises.writeFile(path.join(targetDir, 'SKILL.md'), '# User managed\n');

    await service.removeSyncedAgentSkillLink(targetDir);

    await expect(fs.promises.stat(path.join(targetDir, 'SKILL.md'))).resolves.toBeDefined();
  });

  it('unlinks synced symlinks that point into the central skills root', async () => {
    const service = new SkillsService() as unknown as SkillsServiceInternals;
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'emdash-skills-test-'));
    tempDirs.push(root);
    const targetDir = path.join(root, 'agent-skill');
    const centralSkillDir = path.join(os.homedir(), '.agentskills', 'agent-skill');
    await fs.promises.symlink(centralSkillDir, targetDir, 'junction');

    await service.removeSyncedAgentSkillLink(targetDir);

    await expect(fs.promises.lstat(targetDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
