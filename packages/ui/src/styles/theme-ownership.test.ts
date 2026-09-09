import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(__dirname, '../..');
const sourceRoot = resolve(packageRoot, 'src');
const thisFile = resolve(__dirname, 'theme-ownership.test.ts');
const scannedExtensions = ['.js', '.json', '.mjs', '.ts', '.tsx'];

function listFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return listFiles(path);
    return scannedExtensions.some((extension) => path.endsWith(extension)) ? [path] : [];
  });
}

function listEntries(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    return entry.isDirectory() ? listEntries(path) : [path];
  });
}

const configuredFiles = [
  resolve(packageRoot, '.storybook/main.ts'),
  resolve(packageRoot, '.storybook/preview.tsx'),
  resolve(packageRoot, 'package.json'),
  resolve(packageRoot, 'scripts/build-library.ts'),
  resolve(packageRoot, 'scripts/build-styles.ts'),
  resolve(packageRoot, 'tsconfig.build.json'),
  resolve(packageRoot, 'tsconfig.json'),
  resolve(packageRoot, 'vitest.config.ts'),
];

function scannedFiles(): string[] {
  return [...listFiles(sourceRoot), ...configuredFiles].filter((path) => path !== thisFile);
}

describe('@emdash/ui Theme ownership boundary', () => {
  it('contains no retired alias, Token-reference form, or local Theme contract creation', () => {
    const themeAlias = ['@', 'theme'].join('');
    const retiredReferences = new RegExp(
      `${themeAlias}(?:/|['"])|(?:^|[/])theme/(?:core/contract|tokens)(?:[/'"])|\\b(?:vars|tokenVars)\\.`,
      'gm'
    );
    const createContract = ['createGlobal', 'ThemeContract'].join('');
    const violations = scannedFiles().flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      const matches = [...source.matchAll(retiredReferences)].map((match) => match[0]);
      if (source.includes(createContract)) matches.push(createContract);
      return matches.map((match) => `${relative(packageRoot, path)}:${match}`);
    });

    expect(violations).toEqual([]);
  });

  it('has no UI-local Theme source tree or retired package metadata', () => {
    const packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
      files: readonly string[];
    };
    const serializedExports = JSON.stringify(packageJson.exports);

    expect(listEntries(resolve(sourceRoot, 'theme'))).toEqual([]);
    expect(packageJson.files).toEqual(['dist']);
    expect(serializedExports).not.toContain(['src', 'theme'].join('/'));
    expect(serializedExports).not.toContain('"./setup');
    expect(serializedExports).not.toContain('"./theme"');
    expect(serializedExports).not.toContain('"./tokens');
    expect(serializedExports).not.toContain('"development"');
  });

  it('does not define or re-export the canonical Theme Token tree', () => {
    const tokenExport =
      /\bexport\s+(?:(?:declare\s+)?(?:const|class|interface|type)\s+(?:tokens|Tokens)\b|(?:type\s+)?\{[^}]*\b(?:tokens|Tokens)\b[^}]*\}\s+from|[*]\s+from\s+['"]@emdash\/theme)/m;
    const violations = listFiles(sourceRoot)
      .filter((path) => path !== thisFile)
      .filter((path) => tokenExport.test(readFileSync(path, 'utf8')))
      .map((path) => relative(packageRoot, path));

    expect(violations).toEqual([]);
  });
});
