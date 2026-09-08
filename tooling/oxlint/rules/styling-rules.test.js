import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const pluginPath = path.join(repoRoot, 'tooling/oxlint/index.js');

test('styling-import-boundaries rejects direct VE and retired setup imports', async () => {
  const invalid = await lintFixture({
    rule: 'styling-import-boundaries',
    filename: 'packages/ui/src/button.css.ts',
    source: [
      "import { style } from '@vanilla-extract/css';",
      "import '@emdash/theme/theme.css';",
      'export const button = style({ color: "red" });',
    ].join('\n'),
  });
  assert.equal(invalid.diagnostics.length, 2, invalid.output);
  assert.match(invalid.output, /direct Vanilla Extract import/);
  assert.match(invalid.output, /retired styling setup import/);

  const valid = await lintFixture({
    rule: 'styling-import-boundaries',
    filename: 'packages/ui/src/button.css.ts',
    source: [
      "import { style } from '@emdash/ui/styles';",
      "import { tokens } from '@emdash/theme';",
      'export const button = style({ color: tokens.foreground.default });',
    ].join('\n'),
  });
  assert.equal(valid.diagnostics.length, 0, valid.output);

  const internalInterface = await lintFixture({
    rule: 'styling-import-boundaries',
    filename: 'packages/ui/src/button.css.ts',
    source:
      "import { createLayerStyle } from './styles/authoring/layer-rule';\ncreateLayerStyle({}, 'emdash.recipes');",
  });
  assert.equal(internalInterface.diagnostics.length, 1, internalInterface.output);
  assert.match(internalInterface.output, /internal styling infrastructure/);

  const infrastructure = await lintFixture({
    rule: 'styling-import-boundaries',
    filename: 'packages/ui/src/styles/authoring/layer-rule.ts',
    source: "import { style } from '@vanilla-extract/css';\nexport { style };",
    registries: {
      'styling-infrastructure.json': {
        modules: ['packages/ui/src/styles/authoring/layer-rule.ts'],
      },
    },
  });
  assert.equal(infrastructure.diagnostics.length, 0, infrastructure.output);
});

test('styling-layer-boundaries rejects caller-selected layers', async () => {
  const invalid = await lintFixture({
    rule: 'styling-layer-boundaries',
    filename: 'packages/ui/src/button.css.ts',
    source: [
      "import { style } from '@emdash/ui/styles';",
      "export const button = style({ '@layer': { 'emdash.utilities': { color: 'red' } } });",
    ].join('\n'),
  });
  assert.equal(invalid.diagnostics.length, 1, invalid.output);
  assert.match(invalid.output, /must not select a cascade layer/);

  const valid = await lintFixture({
    rule: 'styling-layer-boundaries',
    filename: 'packages/ui/src/button.css.ts',
    source: [
      "import { style } from '@emdash/ui/styles';",
      "export const button = style({ color: 'red' });",
    ].join('\n'),
  });
  assert.equal(valid.diagnostics.length, 0, valid.output);

  const infrastructure = await lintFixture({
    rule: 'styling-layer-boundaries',
    filename: 'packages/ui/src/styles/authoring/layer-rule.ts',
    source: "export const wrapped = { '@layer': { 'emdash.recipes': { color: 'red' } } };",
    registries: {
      'styling-infrastructure.json': {
        modules: ['packages/ui/src/styles/authoring/layer-rule.ts'],
      },
    },
  });
  assert.equal(infrastructure.diagnostics.length, 0, infrastructure.output);
});

test('recipe-utility-conflicts rejects overlaps and dynamic composition', async () => {
  const overlapping = await lintFixture({
    rule: 'recipe-utility-conflicts',
    filename: 'packages/ui/src/button.css.ts',
    source: [
      "import { style, sx } from '@emdash/ui/styles';",
      "export const button = style([sx({ px: '2' }), { paddingLeft: '1rem' }]);",
    ].join('\n'),
  });
  assert.equal(overlapping.diagnostics.length, 1, overlapping.output);
  assert.match(overlapping.output, /padding-left/);

  const dynamic = await lintFixture({
    rule: 'recipe-utility-conflicts',
    filename: 'packages/ui/src/button.css.ts',
    source: [
      "import { style, sx } from '@emdash/ui/styles';",
      'const externalClass = getClass();',
      "export const button = style([externalClass, sx({ px: '2' })]);",
    ].join('\n'),
  });
  assert.equal(dynamic.diagnostics.length, 1, dynamic.output);
  assert.match(dynamic.output, /cannot prove property ownership/);

  const valid = await lintFixture({
    rule: 'recipe-utility-conflicts',
    filename: 'packages/ui/src/button.css.ts',
    source: [
      "import { style, sx } from '@emdash/ui/styles';",
      "export const button = style([sx({ px: '2' }), { color: 'red' }]);",
    ].join('\n'),
  });
  assert.equal(valid.diagnostics.length, 0, valid.output);
});

test('rooted-global-adapters rejects ordinary Globals and ad hoc SVG selectors', async () => {
  const invalid = await lintFixture({
    rule: 'rooted-global-adapters',
    filename: 'packages/ui/src/button.css.ts',
    source: [
      "import { globalStyle } from '@emdash/ui/styles';",
      "globalStyle('body', { margin: 0 });",
      "globalStyle('.button svg', { width: '1rem' });",
    ].join('\n'),
  });
  assert.equal(invalid.diagnostics.length, 2, invalid.output);
  assert.match(invalid.output, /declared Global Adapter/);
  assert.match(invalid.output, /ad hoc SVG Global Rule/);

  const valid = await lintFixture({
    rule: 'rooted-global-adapters',
    filename: 'packages/ui/src/icon-slot.adapter.css.ts',
    source: [
      "import { globalStyle, style } from '@vanilla-extract/css';",
      'const iconSlotRoot = style({});',
      "globalStyle(`${iconSlotRoot} > svg`, { width: '1rem' });",
    ].join('\n'),
    registries: {
      'global-adapters.json': {
        modules: ['packages/ui/src/icon-slot.adapter.css.ts'],
      },
    },
  });
  assert.equal(valid.diagnostics.length, 0, valid.output);
});

test('host-adapter-boundaries limits host authoring to declared modules', async () => {
  const invalid = await lintFixture({
    rule: 'host-adapter-boundaries',
    filename: 'apps/emdash-desktop/src/renderer/feature.css.ts',
    source: "import { hostStyle } from '@emdash/ui/styles/host';\nhostStyle({ color: 'red' });",
  });
  assert.equal(invalid.diagnostics.length, 1, invalid.output);
  assert.match(invalid.output, /declared Host Styling Adapter/);

  const valid = await lintFixture({
    rule: 'host-adapter-boundaries',
    filename: 'apps/emdash-desktop/src/renderer/desktop-host.adapter.css.ts',
    source: "import { hostStyle } from '@emdash/ui/styles/host';\nhostStyle({ color: 'red' });",
    registries: {
      'host-adapters.json': {
        modules: ['apps/emdash-desktop/src/renderer/desktop-host.adapter.css.ts'],
      },
    },
  });
  assert.equal(valid.diagnostics.length, 0, valid.output);
});

test('no-legacy-visual-properties rejects author-facing unprefixed custom properties', async () => {
  const invalid = await lintFixture({
    rule: 'no-legacy-visual-properties',
    filename: 'packages/ui/src/button.css.ts',
    source: "export const button = { color: 'var(--surface-foreground)' };",
  });
  assert.equal(invalid.diagnostics.length, 1, invalid.output);
  assert.match(invalid.output, /--surface-foreground/);

  const valid = await lintFixture({
    rule: 'no-legacy-visual-properties',
    filename: 'packages/ui/src/button.css.ts',
    source: [
      "export const canonical = { color: 'var(--em-foreground-default)' };",
      "export const local = { gap: 'var(--_button-gap)' };",
    ].join('\n'),
  });
  assert.equal(valid.diagnostics.length, 0, valid.output);
});

test('no-important rejects important declarations in CSS-in-TypeScript', async () => {
  const invalid = await lintFixture({
    rule: 'no-important',
    filename: 'packages/ui/src/button.css.ts',
    source: "export const button = { color: 'red !important' };",
  });
  assert.equal(invalid.diagnostics.length, 1, invalid.output);
  assert.match(invalid.output, /!important/);

  const valid = await lintFixture({
    rule: 'no-important',
    filename: 'packages/ui/src/button.css.ts',
    source: "export const button = { color: 'red' };",
  });
  assert.equal(valid.diagnostics.length, 0, valid.output);
});

async function lintFixture({ rule, filename, source, registries = {} }) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'emdash-styling-rule-'));
  try {
    const fixturePath = path.join(tempRoot, filename);
    const registryDir = path.join(tempRoot, 'registries');
    await mkdir(path.dirname(fixturePath), { recursive: true });
    await mkdir(registryDir, { recursive: true });
    await writeFile(fixturePath, `${source}\n`);
    for (const [name, registry] of Object.entries(registries)) {
      await writeFile(path.join(registryDir, name), `${JSON.stringify(registry, null, 2)}\n`);
    }

    const configPath = path.join(tempRoot, '.oxlintrc.json');
    await writeFile(
      configPath,
      JSON.stringify(
        {
          plugins: ['eslint', 'typescript'],
          jsPlugins: [pluginPath],
          env: { node: true, es2020: true },
          rules: {
            [`emdash/${rule}`]: [
              'error',
              {
                repoRoot: tempRoot,
                uiRoot: path.join(tempRoot, 'packages/ui/src'),
                desktopRoot: path.join(tempRoot, 'apps/emdash-desktop/src'),
                registryDir,
              },
            ],
          },
        },
        null,
        2
      )
    );

    const result = await runOxlint(configPath, fixturePath);
    return {
      ...result,
      diagnostics: parseDiagnostics(result.output),
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function runOxlint(config, file) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'pnpm',
      ['exec', 'oxlint', '--config', config, '--format', 'json', '--quiet', file],
      {
        cwd: repoRoot,
        env: { ...process.env, EMDASH_DISABLE_STYLING_ALLOWLISTS: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
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

function parseDiagnostics(output) {
  const start = output.indexOf('{');
  if (start === -1) return [];
  try {
    return JSON.parse(output.slice(start)).diagnostics ?? [];
  } catch {
    return [];
  }
}
