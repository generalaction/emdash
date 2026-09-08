import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import {
  findCssCompatibilityProblems,
  findForbiddenThemeProductPaths,
  findHostEntrypointProblems,
  findIntegrationCoverageGaps,
  findProfileParityMismatches,
  findTailwindAliasProblems,
} from './convergence.mjs';

test('every atomic-cutover convergence check is active', () => {
  const config = JSON.parse(readFileSync(resolve(import.meta.dirname, 'config.json'), 'utf8'));

  assert.deepEqual(
    Object.fromEntries(Object.entries(config).map(([name, check]) => [name, check.active])),
    {
      cssCompatibilityRemoval: true,
      hostEntrypoints: true,
      profileParity: true,
      integrationManifestCoverage: true,
      themeProductPathRemoval: true,
      tailwindAliasConvergence: true,
    }
  );
  assert.deepEqual(
    config.hostEntrypoints.entries.map((entry) => entry.name),
    ['desktop', 'desktop-browser-tests', 'ui-storybook']
  );
});

test('host entrypoint convergence requires one UI stylesheet before host CSS', () => {
  assert.deepEqual(
    findHostEntrypointProblems(
      [
        "import '@emdash/ui/styles.css';",
        "import './desktop-host.css';",
        "import { render } from './render';",
      ].join('\n'),
      './desktop-host.css'
    ),
    []
  );
  assert.deepEqual(
    findHostEntrypointProblems("import '@emdash/ui/styles.css';", './desktop-host.css'),
    ['expected exactly one host stylesheet import ./desktop-host.css, found 0']
  );

  assert.deepEqual(
    findHostEntrypointProblems(
      [
        "import './desktop-host.css';",
        "import '@emdash/ui/style.css';",
        "import '@emdash/ui/styles.css';",
        "import '@emdash/ui/styles.css';",
      ].join('\n'),
      './desktop-host.css'
    ),
    [
      'expected exactly one @emdash/ui/styles.css import, found 2',
      '@emdash/ui/styles.css must load before ./desktop-host.css',
      'retired stylesheet import remains: @emdash/ui/style.css',
    ]
  );
  assert.deepEqual(
    findHostEntrypointProblems(
      [
        "@import '@emdash/ui/styles.css';",
        "@import './vendor.css';",
        "@import './index.css';",
      ].join('\n'),
      './index.css'
    ),
    []
  );
});

test('CSS compatibility convergence requires one canonical export and no retired paths', () => {
  assert.deepEqual(
    findCssCompatibilityProblems({
      canonicalExport: './styles.css',
      canonicalTarget: './dist/styles.css',
      cssExports: { './styles.css': './dist/styles.css' },
      existingForbiddenFiles: [],
      retiredReferences: [],
    }),
    []
  );
  assert.deepEqual(
    findCssCompatibilityProblems({
      canonicalExport: './styles.css',
      canonicalTarget: './dist/styles.css',
      cssExports: {
        './style.css': './dist/style.css',
        './styles.css': './dist/other.css',
      },
      existingForbiddenFiles: ['packages/ui/vite.lib.config.ts'],
      retiredReferences: ['apps/desktop/main.tsx: @emdash/ui/style.css'],
    }),
    [
      'expected ./styles.css to target ./dist/styles.css, found ./dist/other.css',
      'expected only public CSS export ./styles.css, found ./style.css, ./styles.css',
      'retired CSS compatibility file remains: packages/ui/vite.lib.config.ts',
      'retired CSS compatibility reference remains: apps/desktop/main.tsx: @emdash/ui/style.css',
    ]
  );
});

test('profile parity compares every bootstrap and provider class set', () => {
  assert.deepEqual(
    findProfileParityMismatches(
      {
        'dark/compact/inter': ['em-color-dark', 'em-density-compact', 'em-type-inter'],
        'light/cozy/inter': ['em-color-light', 'em-density-cozy', 'em-type-inter'],
      },
      {
        'dark/compact/inter': ['em-type-inter', 'em-color-dark', 'em-density-compact'],
        'light/cozy/inter': ['em-color-light', 'em-density-cozy', 'em-type-inter'],
      }
    ),
    []
  );

  assert.deepEqual(
    findProfileParityMismatches(
      {
        'dark/compact/inter': ['em-color-dark', 'em-density-compact'],
        'light/cozy/inter': ['em-color-light'],
      },
      {
        'dark/compact/inter': ['em-color-dark'],
        'high-contrast/cozy/inter': ['em-color-high-contrast'],
      }
    ),
    [
      'dark/compact/inter: bootstrap [em-color-dark, em-density-compact] != provider [em-color-dark]',
      'high-contrast/cozy/inter: missing bootstrap profile combination',
      'light/cozy/inter: missing provider profile combination',
    ]
  );
});

test('integration manifest coverage requires property, writer, reader, and Theme mapping', () => {
  assert.deepEqual(
    findIntegrationCoverageGaps({
      foreground: {
        property: '--_monaco-foreground',
        writer: 'foreground',
        reader: 'editor.foreground',
        theme: 'foreground.default',
      },
      background: {
        property: '--_monaco-background',
        writer: 'background',
        reader: '',
        theme: 'surface.current',
      },
    }),
    ['background: missing reader']
  );
});

test('Theme product-path convergence reports paths that still exist', () => {
  const tokens = {
    foreground: {
      default: 'var(--em-foreground-default)',
      diffAdded: 'var(--em-foreground-diff-added)',
    },
    workflow: {
      inReview: 'var(--em-workflow-in-review)',
    },
  };

  assert.deepEqual(
    findForbiddenThemeProductPaths(tokens, [
      'foreground.diffAdded',
      'workflow.inReview',
      'vcs.conflict',
    ]),
    ['foreground.diffAdded', 'workflow.inReview']
  );
});

test('Tailwind alias convergence rejects noncanonical and duplicate targets', () => {
  assert.deepEqual(
    findTailwindAliasProblems(
      [
        '@theme inline {',
        '  --color-background: var(--em-surface);',
        '  --color-foreground: var(--em-foreground);',
        '}',
      ].join('\n')
    ),
    []
  );
  assert.deepEqual(
    findTailwindAliasProblems(
      [
        '@theme inline {',
        '  --color-background: var(--background);',
        '  --color-background: var(--em-surface);',
        '  --color-foreground: #fff;',
        '}',
      ].join('\n')
    ),
    [
      '--color-background: duplicate target',
      '--color-background: noncanonical value var(--background)',
      '--color-foreground: noncanonical value #fff',
    ]
  );
});
