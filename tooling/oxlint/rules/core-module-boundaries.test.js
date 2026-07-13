import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import {
  classifyCorePath,
  classifyImportSpecifier,
  isAllowedCoreModuleDependency,
} from './core-module-boundaries.js';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const coreSrcRoot = path.join(repoRoot, 'packages/core/src');

test('classifies core module source files', () => {
  assert.deepEqual(
    classifyCorePath(path.join(coreSrcRoot, 'runtimes/git/node/git-runtime.ts'), coreSrcRoot),
    {
      type: 'runtimes',
      moduleName: 'git',
    }
  );
  assert.deepEqual(
    classifyCorePath(
      path.join(coreSrcRoot, 'services/fs-watch/api/index.ts').replaceAll('/', '\\'),
      coreSrcRoot
    ),
    {
      type: 'services',
      moduleName: 'fs-watch',
    }
  );
  assert.equal(classifyCorePath(path.join(repoRoot, 'packages/core/src/workspace-server/index.ts')), undefined);
});

test('classifies alias, package, and relative imports', () => {
  const fromFile = path.join(coreSrcRoot, 'services/agent-plugins/api/plugins/index.ts');

  assert.deepEqual(classifyImportSpecifier('@runtimes/acp/api', fromFile, coreSrcRoot), {
    type: 'runtimes',
    moduleName: 'acp',
  });
  assert.deepEqual(
    classifyImportSpecifier('@emdash/core/primitives/path/api', fromFile, coreSrcRoot),
    {
      type: 'primitives',
      moduleName: 'path',
    }
  );
  assert.deepEqual(classifyImportSpecifier('../../../host-dependencies/api', fromFile, coreSrcRoot), {
    type: 'services',
    moduleName: 'host-dependencies',
  });
  assert.equal(classifyImportSpecifier('@emdash/shared', fromFile, coreSrcRoot), undefined);
});

test('allows only the core module dependency graph', () => {
  const runtimeGit = { type: 'runtimes', moduleName: 'git' };
  const runtimeFiles = { type: 'runtimes', moduleName: 'files' };
  const serviceExec = { type: 'services', moduleName: 'exec' };
  const servicePty = { type: 'services', moduleName: 'pty' };
  const primitivePath = { type: 'primitives', moduleName: 'path' };
  const primitiveHost = { type: 'primitives', moduleName: 'host' };

  assert.equal(isAllowedCoreModuleDependency(runtimeGit, runtimeGit), true);
  assert.equal(isAllowedCoreModuleDependency(runtimeGit, runtimeFiles), false);
  assert.equal(isAllowedCoreModuleDependency(runtimeGit, serviceExec), true);
  assert.equal(isAllowedCoreModuleDependency(runtimeGit, primitivePath), true);
  assert.equal(isAllowedCoreModuleDependency(serviceExec, primitivePath), true);
  assert.equal(isAllowedCoreModuleDependency(serviceExec, servicePty), false);
  assert.equal(isAllowedCoreModuleDependency(serviceExec, runtimeGit), false);
  assert.equal(isAllowedCoreModuleDependency(primitivePath, primitiveHost), true);
  assert.equal(isAllowedCoreModuleDependency(primitivePath, serviceExec), false);
  assert.equal(isAllowedCoreModuleDependency(primitivePath, runtimeGit), false);
});

test('oxlint visitor reports imports, re-exports, and dynamic imports', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'emdash-core-boundaries-'));
  try {
    const fixtureCoreRoot = path.join(tempRoot, 'packages/core/src');
    const serviceDir = path.join(fixtureCoreRoot, 'services/example/api');
    const primitiveDir = path.join(fixtureCoreRoot, 'primitives/example/api');
    await mkdir(serviceDir, { recursive: true });
    await mkdir(primitiveDir, { recursive: true });
    await writeFile(
      path.join(tempRoot, '.oxlintrc.json'),
      JSON.stringify(
        {
          plugins: ['eslint', 'typescript'],
          jsPlugins: [path.join(repoRoot, 'tooling/oxlint/index.js')],
          env: { node: true, es2020: true },
          rules: {
            'emdash/core-module-boundaries': ['error', { coreSrcRoot: fixtureCoreRoot }],
          },
        },
        null,
        2
      )
    );
    await writeFile(
      path.join(primitiveDir, 'valid.ts'),
      "export const ok = 1;\n"
    );
    await writeFile(
      path.join(serviceDir, 'invalid.ts'),
      [
        "import { x } from '@runtimes/git/api';",
        "export { y } from '@runtimes/files/api';",
        "await import('@runtimes/acp/api');",
      ].join('\n'),
      'utf8'
    );

    const result = await runOxlint(
      path.join(tempRoot, '.oxlintrc.json'),
      path.join(fixtureCoreRoot, 'services/example/api/invalid.ts')
    );
    assert.notEqual(result.code, 0);
    assert.match(result.output, /emdash\(core-module-boundaries\)/);
    assert.match(result.output, /services\/example must not import runtimes\/git/);
    assert.match(result.output, /services\/example must not import runtimes\/files/);
    assert.match(result.output, /services\/example must not import runtimes\/acp/);

    const validResult = await runOxlint(path.join(tempRoot, '.oxlintrc.json'), path.join(primitiveDir, 'valid.ts'));
    assert.equal(validResult.code, 0, validResult.output);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
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
