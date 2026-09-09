import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  collectStylingViolations,
  findStaleStylingEntries,
  validateStylingManifest,
  validateStylingRegistry,
} from './styling-ratchet.mjs';

test('collectStylingViolations extracts exact rule ids from diagnostics', () => {
  const violations = collectStylingViolations([
    diagnostic(
      'emdash(styling-import-boundaries)',
      'packages/ui/src/button.css.ts',
      'Direct import. [emdash-styling:direct-ve:%40vanilla-extract%2Fcss:1]'
    ),
    diagnostic(
      'emdash(styling-import-boundaries)',
      'packages/ui/src/button.css.ts',
      'Retired setup. [emdash-styling:retired-setup:%40emdash%2Ftheme%2Ftheme.css:1]'
    ),
    diagnostic('emdash(no-unused-vars)', 'packages/ui/src/button.css.ts', 'unrelated'),
  ]);

  assert.deepEqual(
    [...violations['styling-import-boundaries']],
    [
      'packages/ui/src/button.css.ts::direct-ve:%40vanilla-extract%2Fcss:1',
      'packages/ui/src/button.css.ts::retired-setup:%40emdash%2Ftheme%2Ftheme.css:1',
    ]
  );
});

test('findStaleStylingEntries rejects removed violations and exceptions', () => {
  const stale = findStaleStylingEntries(
    {
      violations: [
        'packages/ui/src/a.css.ts::direct-ve:%40vanilla-extract%2Fcss:1',
        'packages/ui/src/fixed.css.ts::direct-ve:%40vanilla-extract%2Fcss:1',
      ],
      exceptions: [
        {
          id: 'packages/ui/src/foreign.css.ts::direct-ve:%40vanilla-extract%2Fcss:1',
          reason: 'External constraint: upstream package requires direct VE metadata.',
          fixture:
            'tooling/oxlint/fixtures/permanent-exceptions/styling-import-boundaries/upstream.css.ts',
        },
      ],
    },
    new Set(['packages/ui/src/a.css.ts::direct-ve:%40vanilla-extract%2Fcss:1'])
  );

  assert.deepEqual(stale, [
    'packages/ui/src/fixed.css.ts::direct-ve:%40vanilla-extract%2Fcss:1',
    'packages/ui/src/foreign.css.ts::direct-ve:%40vanilla-extract%2Fcss:1',
  ]);
});

test('validateStylingManifest requires sorted unique exact entries', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'emdash-styling-manifest-'));
  try {
    const result = validateStylingManifest(
      'styling-import-boundaries',
      {
        violations: ['z::direct-ve:x:1', 'a::direct-ve:x:1', 'a::direct-ve:x:1'],
        exceptions: [],
      },
      tempRoot
    );
    assert.deepEqual(result, [
      'violations must be sorted',
      'violations contains duplicate id: a::direct-ve:x:1',
    ]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('validateStylingManifest requires an external-constraint reason and focused fixture', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'emdash-styling-exception-'));
  try {
    const fixture =
      'tooling/oxlint/fixtures/permanent-exceptions/styling-import-boundaries/upstream.css.ts';
    await mkdir(path.join(tempRoot, path.dirname(fixture)), { recursive: true });
    await writeFile(path.join(tempRoot, fixture), "import '@vanilla-extract/css';\n");

    assert.deepEqual(
      validateStylingManifest(
        'styling-import-boundaries',
        {
          violations: [],
          exceptions: [
            {
              id: 'packages/ui/src/foreign.css.ts::direct-ve:x:1',
              reason: 'Needed for upstream.',
              fixture,
            },
          ],
        },
        tempRoot
      ),
      [
        'exception packages/ui/src/foreign.css.ts::direct-ve:x:1 needs an external-constraint reason',
      ]
    );

    assert.deepEqual(
      validateStylingManifest(
        'styling-import-boundaries',
        {
          violations: [],
          exceptions: [
            {
              id: 'packages/ui/src/foreign.css.ts::direct-ve:x:1',
              reason: 'External constraint: upstream requires direct VE metadata.',
              fixture: 'tooling/oxlint/rules/unfocused.ts',
            },
          ],
        },
        tempRoot
      ),
      [
        'exception packages/ui/src/foreign.css.ts::direct-ve:x:1 needs a fixture under tooling/oxlint/fixtures/permanent-exceptions/styling-import-boundaries/',
      ]
    );

    assert.deepEqual(
      validateStylingManifest(
        'styling-import-boundaries',
        {
          violations: [],
          exceptions: [
            {
              id: 'packages/ui/src/foreign.css.ts::direct-ve:x:1',
              reason: 'External constraint: upstream requires direct VE metadata.',
              fixture,
            },
          ],
        },
        tempRoot
      ),
      []
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('validateStylingRegistry requires sorted unique existing modules', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'emdash-styling-registry-'));
  try {
    const existing = 'packages/ui/src/styles/authoring/layer-rule.ts';
    await mkdir(path.join(tempRoot, path.dirname(existing)), { recursive: true });
    await writeFile(path.join(tempRoot, existing), 'export {};\n');

    assert.deepEqual(
      validateStylingRegistry(
        'styling-infrastructure',
        {
          modules: [existing, 'missing.ts', existing],
        },
        tempRoot
      ),
      [
        'modules must be sorted',
        `modules contains duplicate path: ${existing}`,
        'registered module does not exist: missing.ts',
      ]
    );
    assert.deepEqual(
      validateStylingRegistry(
        'styling-infrastructure',
        {
          modules: [existing],
        },
        tempRoot
      ),
      []
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function diagnostic(code, filename, message) {
  return { code, filename, message, severity: 'error' };
}
