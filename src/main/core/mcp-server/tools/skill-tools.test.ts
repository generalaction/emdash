/**
 * Unit tests for the `skill.*` MCP tools.
 *
 * Same fake-server + injected-deps pattern as `task-tools.test.ts`.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogIndex, CatalogSkill, SkillFrontmatter } from '@shared/skills/types';
import { _resetSkillDeps, _setSkillDeps, registerSkillTools } from './skill-tools';

type CapturedHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

interface TestServer extends Pick<McpServer, 'registerTool'> {
  handlers: Map<string, CapturedHandler>;
}

function makeTestServer(): TestServer {
  const handlers = new Map<string, CapturedHandler>();
  const server: TestServer = {
    handlers,
    registerTool: ((name: string, _config: unknown, handler: CapturedHandler) => {
      handlers.set(name, handler);
      return { remove: () => undefined } as never;
    }) as McpServer['registerTool'],
  };
  return server;
}

function parseReply(reply: unknown): { isError: boolean; payload: unknown } {
  const r = reply as {
    isError?: boolean;
    content: Array<{ type: 'text'; text: string }>;
  };
  return {
    isError: r.isError === true,
    payload: JSON.parse(r.content[0].text) as unknown,
  };
}

function makeFrontmatter(name: string): SkillFrontmatter {
  return { name, description: `desc for ${name}` };
}

function makeSkill(overrides: Partial<CatalogSkill> = {}): CatalogSkill {
  const base: CatalogSkill = {
    id: 'sample-skill',
    displayName: 'Sample Skill',
    description: 'A sample skill',
    source: 'local',
    frontmatter: makeFrontmatter('sample-skill'),
    installed: false,
  };
  return { ...base, ...overrides };
}

interface MockDeps {
  getCatalog: ReturnType<typeof vi.fn>;
  install: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  uninstall: ReturnType<typeof vi.fn>;
}

function makeMockDeps(): MockDeps {
  return {
    getCatalog: vi.fn(),
    install: vi.fn(),
    create: vi.fn(),
    uninstall: vi.fn().mockResolvedValue(undefined),
  };
}

function installMockDeps(m: MockDeps): void {
  _setSkillDeps({
    getCatalog: m.getCatalog as unknown as () => Promise<CatalogIndex>,
    install: m.install as unknown as (id: string) => Promise<CatalogSkill>,
    create: m.create as unknown as (
      name: string,
      description: string,
      content: string
    ) => Promise<CatalogSkill>,
    uninstall: m.uninstall as unknown as (id: string) => Promise<void>,
  });
}

describe('skill-tools', () => {
  let server: TestServer;
  let deps: MockDeps;

  beforeEach(() => {
    server = makeTestServer();
    registerSkillTools(server as unknown as McpServer);
    deps = makeMockDeps();
    installMockDeps(deps);
  });

  afterEach(() => {
    _resetSkillDeps();
    vi.clearAllMocks();
  });

  it('registers the expected tool catalogue under skill.* names', () => {
    expect([...server.handlers.keys()].sort()).toEqual([
      'skill.createCustom',
      'skill.installFromCatalog',
      'skill.list',
      'skill.uninstall',
    ]);
  });

  describe('skill.list', () => {
    it('returns the full catalog by default', async () => {
      const catalog: CatalogIndex = {
        version: 1,
        lastUpdated: '2026-01-01T00:00:00.000Z',
        skills: [makeSkill({ id: 'a', installed: false }), makeSkill({ id: 'b', installed: true })],
      };
      deps.getCatalog.mockResolvedValue(catalog);

      const handler = server.handlers.get('skill.list')!;
      const reply = await handler({});
      const parsed = parseReply(reply) as {
        isError: boolean;
        payload: CatalogIndex;
      };
      expect(parsed.isError).toBe(false);
      expect(parsed.payload.skills.map((s) => s.id)).toEqual(['a', 'b']);
    });

    it('filters to installed skills when installedOnly is true', async () => {
      const catalog: CatalogIndex = {
        version: 1,
        lastUpdated: '2026-01-01T00:00:00.000Z',
        skills: [makeSkill({ id: 'a', installed: false }), makeSkill({ id: 'b', installed: true })],
      };
      deps.getCatalog.mockResolvedValue(catalog);

      const handler = server.handlers.get('skill.list')!;
      const reply = await handler({ installedOnly: true });
      const parsed = parseReply(reply) as {
        isError: boolean;
        payload: CatalogIndex;
      };
      expect(parsed.isError).toBe(false);
      expect(parsed.payload.skills.map((s) => s.id)).toEqual(['b']);
    });
  });

  describe('skill.uninstall', () => {
    it('without confirm returns CONFIRM_REQUIRED and does not call uninstall', async () => {
      const handler = server.handlers.get('skill.uninstall')!;
      const reply = await handler({ skillId: 'a' });
      const parsed = parseReply(reply) as { isError: boolean; payload: { code: string } };
      expect(parsed.isError).toBe(true);
      expect(parsed.payload.code).toBe('CONFIRM_REQUIRED');
      expect(deps.uninstall).not.toHaveBeenCalled();
    });

    it('with confirm: true calls uninstall(skillId)', async () => {
      const handler = server.handlers.get('skill.uninstall')!;
      const reply = await handler({ skillId: 'a', confirm: true });
      expect(deps.uninstall).toHaveBeenCalledWith('a');
      const parsed = parseReply(reply) as {
        isError: boolean;
        payload: { skillId: string; uninstalled: boolean };
      };
      expect(parsed.isError).toBe(false);
      expect(parsed.payload).toEqual({ skillId: 'a', uninstalled: true });
    });
  });

  describe('skill.createCustom', () => {
    it('happy path → calls create with name, description, content and returns the new skill', async () => {
      const created = makeSkill({ id: 'my-skill', installed: true });
      deps.create.mockResolvedValue(created);

      const handler = server.handlers.get('skill.createCustom')!;
      const reply = await handler({
        name: 'my-skill',
        description: 'My new skill',
        content: '# my-skill\n\nBody.',
      });

      expect(deps.create).toHaveBeenCalledWith('my-skill', 'My new skill', '# my-skill\n\nBody.');
      const parsed = parseReply(reply) as { isError: boolean; payload: CatalogSkill };
      expect(parsed.isError).toBe(false);
      expect(parsed.payload.id).toBe('my-skill');
    });
  });
});
