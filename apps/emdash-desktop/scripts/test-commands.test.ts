import { execFile } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const packages = ['apps', 'packages'].flatMap((parent) =>
  readdirSync(join(workspaceRoot, parent), { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    const directory = join(workspaceRoot, parent, entry.name);
    const manifest = join(directory, 'package.json');
    if (!existsSync(manifest)) return [];
    const { name, scripts } = JSON.parse(readFileSync(manifest, 'utf8')) as {
      name: string;
      scripts?: Record<string, string>;
    };
    return scripts?.test ? [{ name, directory }] : [];
  })
);

type TaskGraph = {
  tasks: Record<string, { target: { project: string; target: string }; cache?: boolean }>;
  dependencies: Record<string, string[]>;
};

async function graphFor(args: string[], cwd = workspaceRoot): Promise<TaskGraph> {
  const { stdout } = await execFileAsync('pnpm', [...args, '--graph=stdout'], {
    cwd,
    env: { ...process.env, NX_DAEMON: 'false' },
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  // pnpm prints the package script banner before Nx's JSON graph.
  return (JSON.parse(stdout.slice(stdout.indexOf('{'))) as { tasks: TaskGraph }).tasks;
}

function testedPackages(graph: TaskGraph): string[] {
  return Object.values(graph.tasks)
    .filter((task) => task.target.target === 'test')
    .map((task) => task.target.project)
    .sort((a, b) => a.localeCompare(b));
}

describe('public test commands', () => {
  it('runs every package test target from the workspace root', async () => {
    expect(testedPackages(await graphFor(['test']))).toEqual(
      packages.map((p) => p.name).sort((a, b) => a.localeCompare(b))
    );
  }, 40_000);

  it.each(packages)(
    'runs only $name tests from its directory',
    async ({ name, directory }) => {
      expect(testedPackages(await graphFor(['test'], directory))).toEqual([name]);
    },
    40_000
  );

  it('runs only the filtered package tests while preparing its build dependencies', async () => {
    const graph = await graphFor(['--filter', '@emdash/plugins', 'test']);
    expect(testedPackages(graph)).toEqual(['@emdash/plugins']);
    expect(graph.tasks).toHaveProperty('@emdash/plugins:build');
    expect(graph.tasks).toHaveProperty('@emdash/core:build');
  }, 40_000);

  it('does not cache watch sessions but keeps prerequisite builds cacheable', async () => {
    const graph = await graphFor(['--filter', '@emdash/plugins', 'test:watch']);
    expect(graph.tasks['@emdash/plugins:test-watch']).toMatchObject({ cache: false });
    expect(graph.tasks['@emdash/plugins:build']).toMatchObject({ cache: true });
  }, 40_000);
});
