import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const allowlistPath = path.join(repoRoot, 'tooling/oxlint/allowlists/legacy-ui-kit.json');

test('reports new legacy UI-kit imports and allows grandfathered files', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'emdash-no-legacy-ui-kit-'));
  try {
    const tempAllowlistPath = path.join(tempRoot, 'legacy-ui-kit.json');
    const allowedPath = path.join(tempRoot, 'grandfathered.ts');
    await writeFile(tempAllowlistPath, JSON.stringify({ files: [allowedPath] }));

    const configPath = path.join(tempRoot, '.oxlintrc.json');
    await writeFile(
      configPath,
      JSON.stringify({
        plugins: ['eslint', 'typescript'],
        jsPlugins: [path.join(repoRoot, 'tooling/oxlint/index.js')],
        env: { node: true, es2020: true },
        rules: {
          'emdash/no-legacy-ui-kit': [
            'error',
            { allowlistPath: tempAllowlistPath, repoRoot: tempRoot },
          ],
        },
      })
    );

    const invalidPath = path.join(tempRoot, 'invalid.ts');
    await writeFile(invalidPath, "import { Button } from '@core/primitives/ui/browser/button';\n");
    const invalidResult = await runOxlint(configPath, invalidPath);
    assert.notEqual(invalidResult.code, 0);
    assert.match(invalidResult.output, /emdash\(no-legacy-ui-kit\)/);

    await writeFile(allowedPath, "import { Button } from '@core/primitives/ui/browser/button';\n");
    const allowedResult = await runOxlint(configPath, allowedPath);
    assert.equal(allowedResult.code, 0, allowedResult.output);

    const validPath = path.join(tempRoot, 'valid.ts');
    await writeFile(validPath, "import { cn } from '@core/primitives/styling/browser/cn';\n");
    const validResult = await runOxlint(configPath, validPath);
    assert.equal(validResult.code, 0, validResult.output);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('repo allowlist only contains files that still import the legacy kit', async () => {
  const parsed = JSON.parse(await readFile(allowlistPath, 'utf8'));
  assert.ok(Array.isArray(parsed.files));
  for (const entry of parsed.files) {
    const contents = await readFile(path.resolve(repoRoot, entry), 'utf8');
    assert.match(
      contents,
      /@core\/primitives\/ui\/browser/,
      `${entry} no longer imports the legacy kit; remove it from legacy-ui-kit.json`
    );
  }
});

function runOxlint(config, file) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'oxlint', '--config', config, file], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}
