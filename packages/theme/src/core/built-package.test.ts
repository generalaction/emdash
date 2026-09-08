import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
  exports: Record<string, unknown>;
};

describe('built @emdash/theme package', () => {
  it('exports built root/profile modules and generated styles without source conditions', () => {
    expect(packageJson.exports['.']).toEqual({
      types: './dist/index.d.mts',
      default: './dist/index.mjs',
    });
    expect(packageJson.exports['./profiles']).toEqual({
      types: './dist/profiles.d.mts',
      default: './dist/profiles.mjs',
    });
    expect(packageJson.exports['./runtime']).toEqual({
      types: './dist/runtime.d.mts',
      default: './dist/runtime.mjs',
    });
    expect(packageJson.exports['./styles.css']).toBe('./src/__generated__/styles.css');
    expect(JSON.stringify(packageJson.exports)).not.toContain('"development"');

    expect(packageJson.exports).not.toHaveProperty('./manifest');
    expect(packageJson.exports).not.toHaveProperty('./densities');
    expect(packageJson.exports).not.toHaveProperty('./theme.css');
    expect(packageJson.exports).not.toHaveProperty('./semantic.css');
  });

  it('keeps the literal Token tree and profile ids navigable through built declarations', () => {
    const dist = resolve(packageRoot, 'dist');
    const declaration = readdirSync(dist)
      .filter((name) => name.endsWith('.d.mts'))
      .map((name) => readFileSync(resolve(dist, name), 'utf8'))
      .join('\n');
    expect(declaration).toContain('readonly palette');
    expect(declaration).toContain('readonly neutral');
    expect(declaration).toContain('readonly step1: "var(--em-neutral-1)"');
    expect(declaration).toContain('readonly raised');
    expect(declaration).toContain('readonly background: "var(--em-surface-raised)"');
    expect(declaration).toContain(
      'readonly foreground: "var(--em-surface-destructive-sunken-foreground)"'
    );
    expect(declaration).toContain('readonly background: "var(--em-surface-info-paper)"');
    expect(declaration).not.toMatch(
      /foreground-diff|foreground-conflict|foreground-merged|status-in-progress|status-in-review/
    );

    const require = createRequire(import.meta.url);
    const typescriptCli = require.resolve('typescript/bin/tsc');
    execFileSync(
      process.execPath,
      [
        typescriptCli,
        '--ignoreConfig',
        '--noEmit',
        '--strict',
        '--skipLibCheck',
        '--target',
        'ES2022',
        '--module',
        'ESNext',
        '--moduleResolution',
        'bundler',
        resolve(packageRoot, 'test-fixtures/public-navigation.ts'),
      ],
      { cwd: packageRoot, stdio: 'pipe' }
    );
  });

  it('loads generated JavaScript from the public package entries', async () => {
    const rootEntry = '@emdash/theme';
    const profilesEntry = '@emdash/theme/profiles';
    const runtimeEntry = '@emdash/theme/runtime';
    const root = await import(rootEntry);
    const profiles = await import(profilesEntry);
    const runtime = await import(runtimeEntry);

    expect(root.tokens.surface.level.raised.background).toBe('var(--em-surface-raised)');
    expect(profiles.TYPOGRAPHY_MANIFEST[0]).toEqual({
      id: 'default',
      label: 'Default',
      selector: '.typography-default',
    });
    expect(
      runtime.resolveTheme({
        colorScheme: 'dark',
        density: 'compact',
        typography: 'default',
      }).classNames
    ).toEqual(['emdark', 'density-compact', 'typography-default']);
  });

  it('generates the complete future styles artifact from all three Profile kinds', async () => {
    const styles = readFileSync(resolve(packageRoot, 'src/__generated__/styles.css'), 'utf8');
    const rootEntry = '@emdash/theme';
    const { tokens } = (await import(rootEntry)) as {
      tokens: object;
    };
    const references = new Set<string>();

    function collectReferences(value: object): void {
      for (const child of Object.values(value)) {
        if (typeof child === 'string') {
          references.add(child.slice(4, -1));
        } else {
          collectReferences(child as object);
        }
      }
    }

    collectReferences(tokens);

    expect(styles).toContain('.emlight {');
    expect(styles).toContain('.density-comfortable {');
    expect(styles).toContain('.typography-default {');
    expect(styles).toContain('--em-font-sans:');
    expect(styles).toContain('--em-motion-duration-fast:');
    expect(styles).toContain('--em-surface-destructive-sunken:');
    expect(styles).toContain('--em-surface-info-paper:');
    for (const property of references) {
      expect(styles, `${property} should be generated`).toContain(`${property}:`);
    }
  });

  it('omits desktop product meanings from every generated Theme stylesheet', () => {
    const productPath =
      /--em-(?:foreground-diff|foreground-conflict|foreground-merged|status-(?:in-progress|in-review|done|todo|cancelled))/;

    const css = readFileSync(resolve(packageRoot, 'src/__generated__/styles.css'), 'utf8');
    expect(css).not.toMatch(productPath);
  });
});
