import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isValidSkillName, type CatalogIndex } from '@emdash/core/skills';
import { afterEach, describe, expect, it } from 'vitest';
import { SkillsService } from './SkillsService';

type SkillsServiceInternals = {
  getSkillShInstallName(sourceRef: string, skillPath: string): string;
  mergeInstalledState(catalog: CatalogIndex): Promise<CatalogIndex>;
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
    expect(installed[0]?.locations).toEqual([
      expect.objectContaining({ relativeDir: '.agents/skills', kind: 'shared' }),
      expect.objectContaining({
        relativeDir: '.claude/skills',
        kind: 'provider',
        providerIds: ['claude'],
      }),
      expect.objectContaining({
        relativeDir: '.cursor/skills',
        kind: 'provider',
        providerIds: ['cursor'],
      }),
    ]);
  });

  it('does not uninstall a skill managed outside Emdash', async () => {
    const homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'emdash-skills-'));
    tempDirs.push(homeDir);
    await writeSkill(homeDir, '.claude/skills', 'reviewer', 'Reviewer');
    const service = new SkillsService({ homeDir });

    expect((await service.getInstalledSkills())[0]?.managedByEmdash).toBe(false);
    await expect(service.createSkill('reviewer', 'Duplicate')).rejects.toThrow('already exists');
    await expect(service.uninstallSkill('reviewer')).rejects.toThrow('installed outside Emdash');

    await expect(
      fs.promises.readFile(path.join(homeDir, '.claude/skills/reviewer/SKILL.md'), 'utf-8')
    ).resolves.toContain('name: reviewer');
  });

  it('rejects a duplicate whose directory has a different name', async () => {
    const homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'emdash-skills-'));
    tempDirs.push(homeDir);
    await writeSkill(homeDir, '.claude/skills', 'custom-directory', 'Reviewer', 'reviewer');
    const service = new SkillsService({ homeDir });

    await expect(service.createSkill('reviewer', 'Duplicate')).rejects.toThrow('already exists');
  });

  it('uninstalls a managed skill by its install directory name', async () => {
    const homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'emdash-skills-'));
    tempDirs.push(homeDir);
    await writeSkill(homeDir, '.agentskills', 'custom-directory', 'Reviewer', 'reviewer');
    const service = new SkillsService({ homeDir });

    const installed = await service.getInstalledSkills();
    expect(installed[0]?.installId).toBe('custom-directory');
    await service.uninstallSkill(installed[0]?.installId ?? installed[0]?.id ?? '');

    await expect(
      fs.promises.access(path.join(homeDir, '.agentskills/custom-directory'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('mirrors created skills and removes only Emdash-managed links', async () => {
    const homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'emdash-skills-'));
    tempDirs.push(homeDir);
    await Promise.all([
      fs.promises.mkdir(path.join(homeDir, '.claude'), { recursive: true }),
      fs.promises.mkdir(path.join(homeDir, '.codex'), { recursive: true }),
      writeSkill(homeDir, '.agentskills', 'reviewer', 'Emdash reviewer'),
      writeSkill(homeDir, '.cursor/skills', 'reviewer', 'Cursor-owned reviewer'),
    ]);
    const service = new SkillsService({ homeDir });

    await service.initialize();
    expect((await service.getInstalledSkills())[0]?.managedByEmdash).toBe(true);

    const canonicalPath = path.join(homeDir, '.agentskills/reviewer');
    await expect(fs.promises.readlink(path.join(homeDir, '.claude/skills/reviewer'))).resolves.toBe(
      canonicalPath
    );
    await expect(fs.promises.readlink(path.join(homeDir, '.codex/skills/reviewer'))).resolves.toBe(
      canonicalPath
    );

    await service.uninstallSkill('reviewer');

    await expect(fs.promises.access(canonicalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      fs.promises.access(path.join(homeDir, '.claude/skills/reviewer'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      fs.promises.readFile(path.join(homeDir, '.cursor/skills/reviewer/SKILL.md'), 'utf-8')
    ).resolves.toContain('Cursor-owned reviewer');
  });

  it('syncs managed skills only to selected agents and reconciles target changes', async () => {
    const homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'emdash-skills-'));
    tempDirs.push(homeDir);
    await Promise.all([
      fs.promises.mkdir(path.join(homeDir, '.claude'), { recursive: true }),
      fs.promises.mkdir(path.join(homeDir, '.codex'), { recursive: true }),
    ]);
    const service = new SkillsService({ homeDir });

    await service.createSkill('reviewer', 'Review changes', undefined, {
      mode: 'providers',
      providerIds: ['claude'],
    });

    const canonicalPath = path.join(homeDir, '.agentskills/reviewer');
    await expect(fs.promises.readlink(path.join(homeDir, '.claude/skills/reviewer'))).resolves.toBe(
      canonicalPath
    );
    await expect(
      fs.promises.access(path.join(homeDir, '.codex/skills/reviewer'))
    ).rejects.toMatchObject({ code: 'ENOENT' });

    await service.setTargets('reviewer', {
      mode: 'providers',
      providerIds: ['codex'],
    });

    await expect(
      fs.promises.access(path.join(homeDir, '.claude/skills/reviewer'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.promises.readlink(path.join(homeDir, '.codex/skills/reviewer'))).resolves.toBe(
      canonicalPath
    );
    expect((await service.getInstalledSkills())[0]?.targets).toEqual({
      mode: 'providers',
      providerIds: ['codex'],
    });
  });

  it('matches catalog skills by their frontmatter name', async () => {
    const homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'emdash-skills-'));
    tempDirs.push(homeDir);
    await writeSkill(homeDir, '.codex/skills', 'custom-directory', 'Reviewer', 'reviewer');
    const service = new SkillsService({ homeDir }) as unknown as SkillsServiceInternals;

    const merged = await service.mergeInstalledState({
      version: 2,
      lastUpdated: new Date(0).toISOString(),
      skills: [
        {
          id: 'reviewer',
          displayName: 'Reviewer',
          description: 'Review changes',
          source: 'openai',
          frontmatter: { name: 'reviewer', description: 'Review changes' },
          installed: false,
        },
      ],
    });

    expect(merged.skills).toHaveLength(1);
    expect(merged.skills[0]).toMatchObject({
      id: 'reviewer',
      installId: 'custom-directory',
      installed: true,
    });
  });

  it('does not match ambiguous catalog skills by name alone', async () => {
    const homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'emdash-skills-'));
    tempDirs.push(homeDir);
    await writeSkill(homeDir, '.codex/skills', 'custom-directory', 'Reviewer', 'reviewer');
    const service = new SkillsService({ homeDir }) as unknown as SkillsServiceInternals;
    const makeCatalogSkill = (id: string) => ({
      id,
      displayName: id,
      description: 'Review changes',
      source: 'skillssh' as const,
      catalogSkillId: 'reviewer',
      frontmatter: { name: 'reviewer', description: 'Review changes' },
      installed: false,
    });

    const merged = await service.mergeInstalledState({
      version: 2,
      lastUpdated: new Date(0).toISOString(),
      skills: [
        makeCatalogSkill('skillssh:owner/one/reviewer'),
        makeCatalogSkill('skillssh:two/two'),
      ],
    });

    expect(merged.skills.filter((skill) => skill.installed)).toHaveLength(1);
    expect(merged.skills.find((skill) => skill.installed)?.id).toBe('custom-directory');
  });
});

async function writeSkill(
  homeDir: string,
  relativeRoot: string,
  name: string,
  description: string,
  frontmatterName = name
): Promise<void> {
  const skillDir = path.join(homeDir, relativeRoot, name);
  await fs.promises.mkdir(skillDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${frontmatterName}\ndescription: ${description}\n---\n`
  );
}
