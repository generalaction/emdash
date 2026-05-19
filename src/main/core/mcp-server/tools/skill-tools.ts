/**
 * Registers the `skill.*` MCP tools.
 *
 * Thin adapters over `SkillsService` (`src/main/core/skills/SkillsService.ts`).
 * The service method names differ slightly from the spec's verbs — the spec
 * says `getCatalog / install / create / uninstall`, the service exposes
 * `getCatalogIndex / installSkill / createSkill / uninstallSkill`. We use
 * the actual service names; the MCP tool surface matches the spec.
 *
 *   skill.list                → `skillsService.getCatalogIndex`
 *   skill.installFromCatalog  → `skillsService.installSkill`
 *   skill.createCustom        → `skillsService.createSkill`
 *   skill.uninstall           → `skillsService.uninstallSkill`
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CatalogIndex, CatalogSkill } from '@shared/skills/types';
import type { skillsService as SkillsServiceSingleton } from '@main/core/skills/SkillsService';
import { formatOk, requireConfirm, withRecording } from './_helpers';

// ─── Lazy deps ────────────────────────────────────────────────────────────

type SkillDeps = {
  getCatalog: () => Promise<CatalogIndex>;
  install: (skillId: string) => Promise<CatalogSkill>;
  create: (name: string, description: string, content: string) => Promise<CatalogSkill>;
  uninstall: (skillId: string) => Promise<void>;
};

let cachedDeps: SkillDeps | null = null;
let cachedDepsPromise: Promise<SkillDeps> | null = null;

async function loadDeps(): Promise<SkillDeps> {
  if (cachedDeps) return cachedDeps;
  if (cachedDepsPromise) return cachedDepsPromise;
  cachedDepsPromise = (async () => {
    const mod: { skillsService: typeof SkillsServiceSingleton } = await import(
      '@main/core/skills/SkillsService'
    );
    cachedDeps = {
      getCatalog: () => mod.skillsService.getCatalogIndex(),
      install: (id) => mod.skillsService.installSkill(id),
      create: (name, description, content) =>
        mod.skillsService.createSkill(name, description, content),
      uninstall: (id) => mod.skillsService.uninstallSkill(id),
    };
    return cachedDeps;
  })();
  return cachedDepsPromise;
}

/** @internal — for tests: inject a ready-made deps object. */
export function _setSkillDeps(deps: SkillDeps): void {
  cachedDeps = deps;
  cachedDepsPromise = Promise.resolve(deps);
}

/** @internal — for tests: clear cached deps. */
export function _resetSkillDeps(): void {
  cachedDeps = null;
  cachedDepsPromise = null;
}

// ─── Tool registration ────────────────────────────────────────────────────

export function registerSkillTools(server: McpServer): void {
  // skill.list ─────────────────────────────────────────────────────────────
  const listInput = { installedOnly: z.boolean().optional() };
  server.registerTool(
    'skill.list',
    {
      title: 'List skills',
      description:
        'Return the merged catalog of available skills (anthropic / openai / local), ' +
        'each tagged with its `installed` state. Pass `installedOnly: true` to filter ' +
        'down to only installed skills.',
      inputSchema: listInput,
    },
    withRecording('skill.list', async (args: z.infer<z.ZodObject<typeof listInput>>) => {
      const deps = await loadDeps();
      const catalog = await deps.getCatalog();
      if (args.installedOnly) {
        return formatOk({
          ...catalog,
          skills: catalog.skills.filter((s) => s.installed),
        });
      }
      return formatOk(catalog);
    }) as never
  );

  // skill.installFromCatalog ───────────────────────────────────────────────
  const installInput = { skillId: z.string() };
  server.registerTool(
    'skill.installFromCatalog',
    {
      title: 'Install skill from catalog',
      description:
        'Install a skill from the merged catalog. Writes the SKILL.md to `~/.agentskills/<id>` ' +
        'and symlinks it into every detected agent skill directory.',
      inputSchema: installInput,
    },
    withRecording(
      'skill.installFromCatalog',
      async (args: z.infer<z.ZodObject<typeof installInput>>) => {
        const deps = await loadDeps();
        const skill = await deps.install(args.skillId);
        return formatOk(skill);
      }
    ) as never
  );

  // skill.createCustom ─────────────────────────────────────────────────────
  const createInput = {
    name: z.string(),
    description: z.string(),
    content: z.string(),
  };
  server.registerTool(
    'skill.createCustom',
    {
      title: 'Create a custom skill',
      description:
        'Create a brand-new local skill (writes a new SKILL.md under `~/.agentskills/<name>`). ' +
        'Skill names must be lowercase letters, numbers, and hyphens (1-64 chars).',
      inputSchema: createInput,
    },
    withRecording('skill.createCustom', async (args: z.infer<z.ZodObject<typeof createInput>>) => {
      const deps = await loadDeps();
      const skill = await deps.create(args.name, args.description, args.content);
      return formatOk(skill);
    }) as never
  );

  // skill.uninstall ────────────────────────────────────────────────────────
  const uninstallInput = {
    skillId: z.string(),
    confirm: z.boolean().optional(),
  };
  server.registerTool(
    'skill.uninstall',
    {
      title: 'Uninstall skill',
      description:
        'Remove a previously-installed skill from `~/.agentskills` and unlink it from agent ' +
        'directories. Destructive — requires confirm: true.',
      inputSchema: uninstallInput,
    },
    withRecording('skill.uninstall', async (args: z.infer<z.ZodObject<typeof uninstallInput>>) => {
      const guard = requireConfirm(args, 'uninstall this skill', { skillId: args.skillId });
      if (guard) return guard;
      const deps = await loadDeps();
      await deps.uninstall(args.skillId);
      return formatOk({ skillId: args.skillId, uninstalled: true });
    }) as never
  );
}

export { registerSkillTools as register };
