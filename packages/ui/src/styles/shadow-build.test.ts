import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(__dirname, '../..');
const require = createRequire(import.meta.url);
const stylesheetPath = resolve(packageRoot, 'dist/styles.css');
const fontManifestPath = resolve(packageRoot, 'dist/styles.fonts.json');
const reportPath = resolve(packageRoot, 'dist/styles.report.json');
const packageJsonPath = resolve(packageRoot, 'package.json');
const canonicalLayerPrelude =
  '@layer emdash.vendor,emdash.reset,emdash.tokens,emdash.base,emdash.recipes,emdash.utilities,emdash.host;';

interface FontArtifact {
  readonly bytes: number;
  readonly family: string;
  readonly file: string;
  readonly id: string;
  readonly initial: boolean;
  readonly style: string;
  readonly subset: string;
  readonly weight: string;
}

interface FontManifest {
  readonly fonts: readonly FontArtifact[];
  readonly initialSubset: string;
  readonly version: 1;
}

interface BudgetResult {
  readonly bytes: number;
  readonly limit: number;
  readonly withinLimit: boolean;
}

interface StylesReport {
  readonly artifact: 'styles.css';
  readonly budgets: {
    readonly gzipCss: BudgetResult;
    readonly initialSubset: BudgetResult;
    readonly rawCss: BudgetResult;
    readonly totalWoff2: BudgetResult;
  };
  readonly loading: {
    readonly cssFiles: readonly ['styles.css'];
    readonly sentinels: Readonly<Record<string, boolean>>;
    readonly unlayeredRules: readonly string[];
    readonly unresolvedImports: readonly string[];
  };
  readonly version: 1;
}

function readOutput(): {
  css: string;
  cssBytes: Buffer;
  fonts: FontManifest;
  report: StylesReport;
} {
  const cssBytes = readFileSync(stylesheetPath);
  return {
    css: cssBytes.toString('utf8'),
    cssBytes,
    fonts: JSON.parse(readFileSync(fontManifestPath, 'utf8')) as FontManifest,
    report: JSON.parse(readFileSync(reportPath, 'utf8')) as StylesReport,
  };
}

function walkBuiltJavaScript(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    return entry.isDirectory()
      ? walkBuiltJavaScript(path)
      : entry.name.endsWith('.js')
        ? [path]
        : [];
  });
}

function layerContains(css: string, layerName: string, sentinel: string): boolean {
  const opening = `@layer ${layerName}{`;
  let searchFrom = 0;

  while (searchFrom < css.length) {
    const start = css.indexOf(opening, searchFrom);
    if (start === -1) return false;

    let depth = 1;
    let cursor = start + opening.length;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '{') depth += 1;
      if (css[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    if (css.slice(start + opening.length, cursor - 1).includes(sentinel)) return true;
    searchFrom = cursor;
  }

  return false;
}

function createPublicPackageLanguageService(entry: string): ts.LanguageService {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };
  const host: ts.LanguageServiceHost = {
    directoryExists: ts.sys.directoryExists,
    fileExists: ts.sys.fileExists,
    getCompilationSettings: () => options,
    getCurrentDirectory: () => packageRoot,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    getDirectories: ts.sys.getDirectories,
    getNewLine: () => ts.sys.newLine,
    getScriptFileNames: () => [entry],
    getScriptSnapshot: (path) => {
      const source = ts.sys.readFile(path);
      return source === undefined ? undefined : ts.ScriptSnapshot.fromString(source);
    },
    getScriptVersion: () => '0',
    readDirectory: ts.sys.readDirectory,
    readFile: ts.sys.readFile,
    realpath: ts.sys.realpath,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
  };
  return ts.createLanguageService(host, ts.createDocumentRegistry());
}

describe('@emdash/ui aggregate stylesheet build', () => {
  it('uses Rollup as the only library build and publishes no parallel Vite stylesheet', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['build']).not.toContain('vite');
    expect(existsSync(resolve(packageRoot, 'vite.lib.config.ts'))).toBe(false);
    expect(packageJson.devDependencies).not.toHaveProperty('@vitejs/plugin-react');
    expect(packageJson.devDependencies).not.toHaveProperty('vite-plugin-dts');
  });

  it('preserves the finite public Input semantics in built declarations', () => {
    execFileSync(
      process.execPath,
      [
        require.resolve('typescript/bin/tsc'),
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
        resolve(packageRoot, 'test-fixtures/public-input.ts'),
      ],
      {
        cwd: packageRoot,
        stdio: 'pipe',
      }
    );
  }, 30_000);

  it('publishes Vanilla Extract-typed StyleRule declarations', () => {
    execFileSync(
      process.execPath,
      [
        require.resolve('typescript/bin/tsc'),
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
        resolve(packageRoot, 'test-fixtures/public-style-rule.ts'),
      ],
      {
        cwd: packageRoot,
        stdio: 'pipe',
      }
    );
  }, 30_000);

  it('publishes the semantic field-control Recipe through built declarations', () => {
    execFileSync(
      process.execPath,
      [
        require.resolve('typescript/bin/tsc'),
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
        resolve(packageRoot, 'test-fixtures/public-field-control.ts'),
      ],
      {
        cwd: packageRoot,
        stdio: 'pipe',
      }
    );
  }, 30_000);

  it('publishes the semantic control Recipe through built declarations', () => {
    execFileSync(
      process.execPath,
      [
        require.resolve('typescript/bin/tsc'),
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
        resolve(packageRoot, 'test-fixtures/public-control.ts'),
      ],
      {
        cwd: packageRoot,
        stdio: 'pipe',
      }
    );
  }, 30_000);

  it('keeps canonical Token completion and Go to Definition on built Theme declarations', () => {
    const fixture = resolve(packageRoot, 'test-fixtures/public-token-authoring.ts');
    execFileSync(
      process.execPath,
      [
        require.resolve('typescript/bin/tsc'),
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
        fixture,
      ],
      {
        cwd: packageRoot,
        stdio: 'pipe',
      }
    );

    const source = readFileSync(fixture, 'utf8');
    const service = createPublicPackageLanguageService(fixture);
    const completionPrefix = 'tokens.surface.tone.destructive.level.';
    const completionPosition = source.indexOf(completionPrefix) + completionPrefix.length;
    const completionNames =
      service
        .getCompletionsAtPosition(fixture, completionPosition, {})
        ?.entries.map((entry) => entry.name)
        .sort() ?? [];
    expect(completionNames).toEqual(['elevated', 'overlay', 'raised', 'sunken']);

    const navigationPath = `${completionPrefix}sunken.foreground`;
    const navigationStart = source.indexOf(navigationPath);
    const definitionPosition = navigationStart + navigationPath.lastIndexOf('foreground') + 1;
    const definition = service
      .getDefinitionAtPosition(fixture, definitionPosition)
      ?.find((entry) => entry.fileName.replaceAll('\\', '/').includes('/packages/theme/dist/'));
    service.dispose();

    expect(definition).toBeDefined();
    const definitionPath = definition!.fileName.replaceAll('\\', '/');
    expect(definitionPath).not.toContain('/packages/ui/');
    expect(definitionPath).not.toContain('/packages/theme/src/');
    const declaration = readFileSync(definition!.fileName, 'utf8');
    const lineStart = declaration.lastIndexOf('\n', definition!.textSpan.start) + 1;
    const lineEnd = declaration.indexOf('\n', definition!.textSpan.start);
    expect(declaration.slice(lineStart, lineEnd)).toContain(
      'readonly foreground: "var(--em-surface-destructive-sunken-foreground)"'
    );
  }, 30_000);

  it('keeps every built runtime entry free of stylesheet side effects', () => {
    for (const file of walkBuiltJavaScript(resolve(packageRoot, 'dist'))) {
      expect(readFileSync(file, 'utf8'), relative(packageRoot, file)).not.toMatch(
        /\bimport\s+['"][^'"]+\.css(?:\?[^'"]*)?['"]/
      );
    }
  });

  it('emits canonical, Theme, shared, Utility, primitive, component, and pattern sentinels', () => {
    const { css, report } = readOutput();

    expect(css).toMatch(
      /@layer emdash\.vendor,\s*emdash\.reset,\s*emdash\.tokens,\s*emdash\.base,\s*emdash\.recipes,\s*emdash\.utilities,\s*emdash\.host/
    );
    expect(css).toContain('--em-neutral-1:');
    expect(css).toContain('--em-surface-raised:');
    expect(css).toContain('--em-surface-overlay:');
    expect(css).toContain('--em-surface-destructive-sunken:');
    expect(css).toContain('--em-surface-info-paper:');
    expect(css).not.toContain('--em-surface-base-emphasis');
    expect(css).not.toContain('--em-surface-elevated-emphasis');
    expect(css).not.toMatch(
      /\.surface-(?:sunken|base|raised|elevated|overlay|paper|emphasis|destructive|warning|info|success)\{/
    );
    expect(css).toContain('box-sizing:border-box');
    expect(css).toContain('scrollbar-width:thin');
    expect(css).toContain('@keyframes accordion-down');
    expect(css).toContain('display:inline-flex');
    expect(css).toContain('button__');
    expect(css).toContain('vertical-align:baseline');
    expect(css).toContain('grid-template-columns:var(--_collection-view-template)');
    expect(css).toContain('@font-face');
    expect(Object.values(report.loading.sentinels).every(Boolean)).toBe(true);
  });

  it('preserves typography role values without the retired UI Token contract', () => {
    const { css } = readOutput();

    expect(css).toContain(
      '.text-role-body{font-family:var(--em-font-sans);font-size:var(--em-text-base);font-weight:var(--em-font-weight-normal);line-height:20px}'
    );
    expect(css).toContain(
      '.text-role-caption{font-family:var(--em-font-sans);font-size:var(--em-text-xs);font-weight:var(--em-font-weight-medium);line-height:16px}'
    );
    expect(css).toContain(
      '.text-role-h1{font-family:var(--em-font-sans);font-size:var(--em-text-xl);font-weight:var(--em-font-weight-medium);line-height:28px}'
    );
    expect(css).toContain(
      '.text-role-code{font-family:var(--em-font-mono);font-size:var(--em-text-sm);font-weight:var(--em-font-weight-normal);line-height:20px}'
    );
    expect(css).toContain(
      '.text-role-mention{font-family:var(--em-font-sans);font-size:var(--em-text-base);font-weight:var(--em-font-weight-semibold);line-height:20px}'
    );
    expect(css).not.toContain('--em-type-');
    expect(css).not.toContain('--em-animate-accordion-');
    expect(css).not.toContain('--em-animate-panel-');
  });

  it('places shared declarations in their namespaced canonical layers', () => {
    const { css, report } = readOutput();
    const legacyLayerBlocks = [...css.matchAll(/@layer\s+(?:reset|tokens|base)\s*\{/g)].map(
      ([declaration]) => declaration
    );

    expect(css.startsWith(canonicalLayerPrelude)).toBe(true);
    expect(legacyLayerBlocks).toEqual([]);
    expect(report.loading.unlayeredRules).toEqual([]);
    expect(layerContains(css, 'emdash.reset', 'box-sizing:border-box')).toBe(true);
    expect(layerContains(css, 'emdash.tokens', '--em-neutral-1:')).toBe(true);
    expect(layerContains(css, 'emdash.tokens', '--em-font-sans:')).toBe(true);
    expect(layerContains(css, 'emdash.base', 'scrollbar-width:thin')).toBe(true);
    expect(layerContains(css, 'emdash.recipes', 'background-clip:padding-box')).toBe(true);
    expect(layerContains(css, 'emdash.utilities', 'display:inline-flex')).toBe(true);
    expect(layerContains(css, 'emdash.utilities', '.text-shimmer{')).toBe(true);
    expect(layerContains(css, 'emdash.utilities', '.scroll-fade__viewport{')).toBe(true);
    expect(layerContains(css, 'emdash.utilities', '@property --_scroll-fade-top')).toBe(true);
  });

  it('places representative primitive styles and recipes in the recipe layer', () => {
    const { css } = readOutput();

    expect(layerContains(css, 'emdash.recipes', 'button__')).toBe(true);
    expect(layerContains(css, 'emdash.recipes', 'badge__')).toBe(true);
    expect(layerContains(css, 'emdash.recipes', 'toast__')).toBe(true);
    expect(layerContains(css, 'emdash.recipes', 'spinner__')).toBe(true);
  });

  it('places representative component and pattern styles in the recipe layer', () => {
    const { css } = readOutput();

    expect(layerContains(css, 'emdash.recipes', 'text-decoration-color:color-mix')).toBe(true);
    expect(layerContains(css, 'emdash.recipes', 'vertical-align:baseline')).toBe(true);
    expect(
      layerContains(css, 'emdash.recipes', 'grid-template-columns:var(--_collection-view-template)')
    ).toBe(true);
  });

  it('contains no unresolved imports and uses valid relative packaged asset references', () => {
    const { css, fonts, report } = readOutput();
    const urls = [...css.matchAll(/url\((?:['"])?([^'")]+)(?:['"])?\)/g)].map(([, url]) => url);

    expect(css).not.toMatch(/@import\b/);
    expect(css).not.toMatch(/@emdash\/|@fontsource|(?:^|[("' ])src\//);
    expect(report.loading.unresolvedImports).toEqual([]);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => url.startsWith('./fonts/'))).toBe(true);

    for (const url of urls) {
      const assetPath = resolve(dirname(stylesheetPath), url);
      expect(relative(dirname(stylesheetPath), assetPath)).not.toMatch(/^\.\./);
      expect(existsSync(assetPath)).toBe(true);
    }

    expect(new Set(urls)).toEqual(new Set(fonts.fonts.map((font) => `./${font.file}`)));
  });

  it('declares every canonical Token Reference used by the aggregate', () => {
    const { css } = readOutput();
    const declarations = new Set(
      [...css.matchAll(/(--em-[A-Za-z0-9_-]+)\s*:/g)].map(([, property]) => property)
    );
    const references = new Set(
      [...css.matchAll(/var\((--em-[A-Za-z0-9_-]+)(?:,|\))/g)].map(([, property]) => property)
    );
    const missing = [...references].filter((property) => !declarations.has(property)).sort();

    expect(missing).toEqual([]);
  });

  it('publishes one aggregate CSS artifact and a declared initial Latin WOFF2 subset', () => {
    const { fonts, report } = readOutput();
    const initialFont = fonts.fonts.find((font) => font.id === fonts.initialSubset);
    const shadowCssFiles = readdirSync(resolve(packageRoot, 'dist'))
      .filter((name) => /^styles.*\.css(?:\.map)?$/.test(name))
      .sort();

    expect(shadowCssFiles).toEqual(['styles.css']);
    expect(report.loading.cssFiles).toEqual(['styles.css']);
    expect(fonts.version).toBe(1);
    expect(fonts.fonts.length).toBeGreaterThan(0);
    expect(initialFont).toMatchObject({
      initial: true,
      subset: 'latin',
    });
    expect(fonts.fonts.filter((font) => font.initial)).toHaveLength(1);

    for (const font of fonts.fonts) {
      expect(font.file).toMatch(/^fonts\/[^/]+\.woff2$/);
      expect(font.bytes).toBe(statSync(resolve(packageRoot, 'dist', font.file)).size);
    }
  });

  it('hard-enforces raw, gzip-9, total WOFF2, and initial-subset budgets', () => {
    const { cssBytes, fonts, report } = readOutput();
    const initialFont = fonts.fonts.find((font) => font.id === fonts.initialSubset);
    const totalFontBytes = fonts.fonts.reduce((total, font) => total + font.bytes, 0);

    expect(report.version).toBe(1);
    expect(report.artifact).toBe('styles.css');
    expect(report.budgets.rawCss).toEqual({
      bytes: cssBytes.byteLength,
      limit: 500_000,
      withinLimit: cssBytes.byteLength <= 500_000,
    });
    expect(report.budgets.gzipCss).toEqual({
      bytes: gzipSync(cssBytes, { level: 9 }).byteLength,
      limit: 150_000,
      withinLimit: gzipSync(cssBytes, { level: 9 }).byteLength <= 150_000,
    });
    expect(report.budgets.totalWoff2).toEqual({
      bytes: totalFontBytes,
      limit: 100_000,
      withinLimit: totalFontBytes <= 100_000,
    });
    expect(report.budgets.initialSubset).toEqual({
      bytes: initialFont?.bytes ?? 0,
      limit: 50_000,
      withinLimit: (initialFont?.bytes ?? 0) <= 50_000,
    });
    expect(Object.values(report.budgets).every((result) => result.withinLimit)).toBe(true);
  });
});
