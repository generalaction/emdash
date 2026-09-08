import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../../..');
const packageRoot = resolve(repoRoot, 'packages/ui');
const themeRoot = resolve(repoRoot, 'packages/theme');
const stylingManifestRoot = resolve(repoRoot, 'tooling/oxlint/allowlists/styling');

const reviewedRecipeExports = [
  './styles/recipes/control',
  './styles/recipes/field-control',
  './styles/recipes/menu-item',
  './styles/recipes/surface',
];

const retiredSourcePaths = [
  'src/react/primitives/box/index.tsx',
  'src/react/primitives/box/box.stories.tsx',
  'src/react/primitives/theme-provider.tsx',
  'src/react/primitives/typography/typography.variants.ts',
  'src/styles/recipes/box.css.ts',
  'src/styles/recipes/box.ts',
  'src/styles/utilities/index.ts',
  'src/styles/utilities/layout.css.ts',
  'src/styles/utilities/sprinkles.css.ts',
];

const retiredThemeCompatibilityPaths = [
  'src/__generated__/semantic.css',
  'src/__generated__/theme.css',
  'src/core/codegen/emit-semantic-css.ts',
  'src/core/codegen/emit-theme-css.ts',
];

const globalRuleInfrastructure = new Set([
  'packages/chat-ui/src/styles/reset.css.ts',
  'packages/ui/src/styles/adapter.ts',
  'packages/ui/src/styles/authoring/layer-rule.ts',
  'packages/ui/src/styles/reset.css.ts',
]);

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function listFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

describe('completed public styling contract', () => {
  it('publishes sx as the sole Style Utility and only the reviewed concrete Recipes', () => {
    const packageJson = readJson(resolve(packageRoot, 'package.json')) as {
      exports: Record<string, unknown>;
    };
    const exportPaths = Object.keys(packageJson.exports);

    expect(exportPaths.filter((path) => path.startsWith('./styles/recipes/')).sort()).toEqual(
      reviewedRecipeExports
    );
    expect(exportPaths).not.toContain('./styles/recipes/box');
    expect(exportPaths).not.toContain('./styles/utilities');
    expect(exportPaths).not.toContain('./styles/sprinkles');
  });

  it('has no Box, named layout helper, split Utility, or React Recipe compatibility source', () => {
    for (const path of retiredSourcePaths) {
      expect(existsSync(resolve(packageRoot, path)), path).toBe(false);
    }

    const primitiveBarrel = readFileSync(
      resolve(packageRoot, 'src/react/primitives/index.ts'),
      'utf8'
    );
    expect(primitiveBarrel).not.toMatch(/from ['"]\.\/box['"]/);

    const libraryBuild = readFileSync(resolve(packageRoot, 'scripts/build-library.ts'), 'utf8');
    expect(libraryBuild).not.toContain("'styles/recipes/box'");
    expect(libraryBuild).not.toContain("'styles/utilities'");
    expect(libraryBuild).not.toContain("'styles/utilities/sprinkles'");
  });

  it('publishes only the controlled Theme runtime and canonical generated Theme CSS', () => {
    const primitiveBarrel = readFileSync(
      resolve(packageRoot, 'src/react/primitives/index.ts'),
      'utf8'
    );
    expect(primitiveBarrel).not.toContain("'./theme-provider'");

    const uiPackageJson = readJson(resolve(packageRoot, 'package.json')) as {
      exports: Record<string, unknown>;
    };
    expect(uiPackageJson.exports).toHaveProperty('./react/theme-runtime');

    const themePackageJson = readJson(resolve(themeRoot, 'package.json')) as {
      exports: Record<string, unknown>;
    };
    expect(themePackageJson.exports).not.toHaveProperty('./manifest');
    expect(themePackageJson.exports).not.toHaveProperty('./densities');
    expect(themePackageJson.exports).not.toHaveProperty('./theme.css');
    expect(themePackageJson.exports).not.toHaveProperty('./semantic.css');

    for (const path of retiredThemeCompatibilityPaths) {
      expect(existsSync(resolve(themeRoot, path)), path).toBe(false);
    }
  });
});

describe('completed Global Rule and migration-debt contract', () => {
  it('keeps Global Rules only in reset/base infrastructure or registered rooted adapters', () => {
    const globalAdapterRegistry = readJson(
      resolve(repoRoot, 'tooling/oxlint/registries/global-adapters.json')
    ) as { modules: string[] };
    const allowed = new Set([...globalRuleInfrastructure, ...globalAdapterRegistry.modules]);
    const sourceRoots = ['apps', 'packages'].map((path) => resolve(repoRoot, path));
    const globalRuleFiles = sourceRoots
      .flatMap(listFiles)
      .filter((path) => path.endsWith('.ts') || path.endsWith('.tsx'))
      .filter((path) => !path.includes('/dist/'))
      .filter((path) => !path.includes('/__fixtures__/') && !path.includes('.test.'))
      .filter((path) =>
        /\b(?:globalStyle|createGlobalLayerStyle)\s*\(/.test(readFileSync(path, 'utf8'))
      )
      .map((path) => relative(repoRoot, path))
      .sort();

    expect(globalRuleFiles).toEqual([...allowed].sort());
  });

  it('has no migration violation manifests or temporary ratchet generator', () => {
    const manifests = existsSync(stylingManifestRoot)
      ? readdirSync(stylingManifestRoot).filter((path) => path.endsWith('.json'))
      : [];

    for (const manifest of manifests) {
      const contents = readJson(resolve(stylingManifestRoot, manifest)) as {
        exceptions?: unknown[];
        violations?: unknown[];
      };
      expect(contents.violations ?? [], manifest).toEqual([]);
      expect(contents.exceptions?.length ?? 0, manifest).toBeGreaterThan(0);
    }

    expect(existsSync(resolve(repoRoot, 'tooling/oxlint/scripts/prune-styling-ratchets.mjs'))).toBe(
      false
    );
    const rootPackageJson = readJson(resolve(repoRoot, 'package.json')) as {
      scripts: Record<string, string>;
    };
    expect(rootPackageJson.scripts).not.toHaveProperty('prune:styling-ratchets');
  });
});
