import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

it('finishes the plugin build before testing plugins alongside their consumers', async () => {
  const { stdout } = await execFileAsync(
    'pnpm',
    [
      'exec',
      'nx',
      'run-many',
      '-t',
      'test',
      '-p',
      '@emdash/plugins,@emdash/emdash-desktop,@emdash/workspace-server',
      '--graph=stdout',
    ],
    {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      env: { ...process.env, NX_DAEMON: 'false' },
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
      shell: process.platform === 'win32',
    }
  );
  const graph = JSON.parse(stdout) as {
    tasks: { dependencies: Record<string, string[]> };
  };
  const prerequisites = new Set<string>();
  const visit = (task: string) => {
    for (const dependency of graph.tasks.dependencies[task] ?? []) {
      if (prerequisites.has(dependency)) continue;
      prerequisites.add(dependency);
      visit(dependency);
    }
  };
  visit('@emdash/plugins:test');

  expect(prerequisites).toContain('@emdash/plugins:build');
}, 40_000);
