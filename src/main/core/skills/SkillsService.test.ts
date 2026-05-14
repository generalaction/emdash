import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadService(home: string) {
  vi.resetModules();
  vi.doMock('node:os', async () => ({
    ...(await vi.importActual<typeof os>('node:os')),
    homedir: () => home,
  }));

  const { SkillsService } = await import('./SkillsService');
  return new SkillsService();
}

describe('SkillsService agent sync', () => {
  let home: string;

  beforeEach(async () => {
    home = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'emdash-skills-'));
  });

  afterEach(async () => {
    vi.doUnmock('node:os');
    vi.resetModules();
    await fs.promises.rm(home, { recursive: true, force: true });
  });

  it('does not replace real agent skill directories while syncing', async () => {
    const service = await loadService(home);
    const centralSkillDir = path.join(home, '.agentskills', 'review');
    const agentSkillDir = path.join(home, '.codex', 'skills', 'review');
    const userFile = path.join(agentSkillDir, 'SKILL.md');

    await fs.promises.mkdir(centralSkillDir, { recursive: true });
    await fs.promises.mkdir(agentSkillDir, { recursive: true });
    await fs.promises.writeFile(userFile, 'user-managed');

    await service.syncToAgents('review');

    expect(await fs.promises.readFile(userFile, 'utf-8')).toBe('user-managed');
    expect((await fs.promises.lstat(agentSkillDir)).isSymbolicLink()).toBe(false);
  });

  it('only removes synced links that point inside the central skills root', async () => {
    const service = await loadService(home);
    const centralSkillDir = path.join(home, '.agentskills', 'review');
    const outsideSkillDir = path.join(home, '.agentskills-other', 'review');
    const agentSkillDir = path.join(home, '.codex', 'skills', 'review');

    await fs.promises.mkdir(centralSkillDir, { recursive: true });
    await fs.promises.mkdir(outsideSkillDir, { recursive: true });
    await fs.promises.mkdir(path.dirname(agentSkillDir), { recursive: true });
    await fs.promises.symlink(outsideSkillDir, agentSkillDir, 'junction');

    await service.unsyncFromAgents('review');

    expect((await fs.promises.lstat(agentSkillDir)).isSymbolicLink()).toBe(true);
  });
});
