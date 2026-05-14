import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadService(home: string, httpsResponses?: Map<string, string>) {
  vi.resetModules();
  vi.doMock('node:os', async () => ({
    ...(await vi.importActual<typeof os>('node:os')),
    homedir: () => home,
  }));
  if (httpsResponses) {
    vi.doMock('node:https', () => ({
      get: vi.fn((url: string, _options: unknown, callback: (res: Readable) => void) => {
        const req = new EventEmitter() as EventEmitter & {
          setTimeout: (timeout: number, callback: () => void) => void;
          destroy: (error?: Error) => void;
        };
        req.setTimeout = vi.fn();
        req.destroy = vi.fn();

        const res = Readable.from([httpsResponses.get(url) ?? '{}']) as Readable & {
          statusCode?: number;
          headers: Record<string, string>;
        };
        res.statusCode = httpsResponses.has(url) ? 200 : 404;
        res.headers = {};
        queueMicrotask(() => callback(res));
        return req;
      }),
    }));
  }

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
    vi.doUnmock('node:https');
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

  it('can load detail for skills returned only by skills.sh search', async () => {
    const responses = new Map([
      [
        'https://skills.sh/api/search?q=superpowers&limit=50',
        JSON.stringify({
          skills: [
            {
              id: 'obra/superpowers/brainstorming',
              skillId: 'brainstorming',
              name: 'brainstorming',
              installs: 156907,
              source: 'obra/superpowers',
            },
          ],
        }),
      ],
      [
        'https://skills.sh/api/download/obra/superpowers/brainstorming',
        JSON.stringify({
          files: [
            {
              path: 'SKILL.md',
              contents: [
                '---',
                'name: brainstorming',
                'description: Brainstorm before implementation',
                '---',
                '',
                '# Brainstorming',
              ].join('\n'),
            },
          ],
        }),
      ],
    ]);
    const service = await loadService(home, responses);

    const search = await service.searchCatalog('superpowers');
    const searchHit = search.skills.find((skill) => skill.id === 'brainstorming');
    const detail = await service.getSkillDetail('brainstorming');

    expect(searchHit?.repoSlug).toBe('obra/superpowers');
    expect(detail?.description).toBe('Brainstorm before implementation');
    expect(detail?.skillMdContent).toContain('# Brainstorming');
  });
});
