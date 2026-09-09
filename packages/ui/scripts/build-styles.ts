import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, extname, relative, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { vanillaExtractPlugin } from '@vanilla-extract/rollup-plugin';
import { transform } from 'lightningcss';
import { rollup } from 'rollup';
import type { OutputAsset, Plugin, RollupLog } from 'rollup';
import { unlayeredRuleHeaders } from './css-layer-gate';

const require = createRequire(import.meta.url);
const packageRoot = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(packageRoot, 'src');
const outputRoot = resolve(packageRoot, 'dist');
const fontsOutputRoot = resolve(outputRoot, 'fonts');
const virtualEntryId = '\0emdash-ui-styles';
const canonicalLayersPath = resolve(sourceRoot, 'styles/authoring/layers.css.ts');
const themeStylesPath = require.resolve('@emdash/theme/styles.css');
const fontStylesPath = require.resolve('@fontsource-variable/jetbrains-mono');
const initialFontId = 'jetbrains-mono-latin-wght-normal';

const budgetLimits = {
  gzipCss: 150_000,
  initialSubset: 50_000,
  rawCss: 500_000,
  totalWoff2: 100_000,
} as const;

interface FontArtifact {
  readonly bytes: number;
  readonly family: string;
  readonly file: string;
  readonly id: string;
  readonly initial: boolean;
  readonly sourcePath: string;
  readonly style: string;
  readonly subset: string;
  readonly weight: string;
}

const aliases = new Map([
  ['@react', resolve(sourceRoot, 'react')],
  ['@styles', resolve(sourceRoot, 'styles')],
  ['@', sourceRoot],
]);

function walkFiles(root: string, matches: (path: string) => boolean): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      paths.push(...walkFiles(path, matches));
    } else if (matches(path)) {
      paths.push(path);
    }
  }
  return paths.sort(compareText);
}

function isProductionVanillaExtractFile(path: string): boolean {
  const packagePath = relative(packageRoot, path).split(sep).join('/');
  return (
    path.endsWith('.css.ts') &&
    !packagePath.includes('/__fixtures__/') &&
    !packagePath.includes('.test.') &&
    !packagePath.includes('.stories.') &&
    !packagePath.endsWith('/react/story-layout.css.ts')
  );
}

function resolveAlias(source: string): string | undefined {
  for (const [alias, replacement] of aliases) {
    if (source === alias) return replacement;
    if (source.startsWith(`${alias}/`)) return resolve(replacement, source.slice(alias.length + 1));
  }
  return undefined;
}

function resolveRollupCssImport(source: string, importer?: string): string | undefined {
  if (!source.match(/\.css(?:\.ts)?$/)) return undefined;
  if (source === '@emdash/theme/styles.css') return themeStylesPath;
  if (source === '@fontsource-variable/jetbrains-mono/index.css') return fontStylesPath;

  const candidate =
    resolveAlias(source) ??
    (source.startsWith('.') && importer ? resolve(dirname(importer), source) : undefined) ??
    (source.startsWith('/') ? source : undefined);

  if (candidate) {
    if (existsSync(candidate)) return candidate;
    if (existsSync(`${candidate}.ts`)) return `${candidate}.ts`;
  }

  try {
    return require.resolve(source);
  } catch {
    return undefined;
  }
}

function aggregateEntryPlugin(
  vanillaExtractFiles: readonly string[],
  rawCssFiles: readonly string[]
): Plugin {
  return {
    name: 'emdash-ui-styles-entry',
    resolveId(source, importer) {
      if (source === virtualEntryId) return virtualEntryId;
      const resolved = resolveRollupCssImport(source, importer);
      return resolved ? { id: resolved, moduleSideEffects: true } : null;
    },
    load(id) {
      if (id === virtualEntryId) {
        const imports = [
          canonicalLayersPath,
          ...vanillaExtractFiles.filter((path) => path !== canonicalLayersPath),
          themeStylesPath,
          ...rawCssFiles,
        ];
        return imports.map((path) => `import ${JSON.stringify(path)};`).join('\n');
      }
      if (id.endsWith('.css') && !id.endsWith('.css.ts') && !id.endsWith('.vanilla.css')) return '';
      return null;
    },
  };
}

function extractInitialFontFace(css: string): string {
  const escapedId = initialFontId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(
    new RegExp(`/\\*\\s*${escapedId}\\s*\\*/\\s*(@font-face\\s*\\{[\\s\\S]*?\\})`)
  );
  if (!match) throw new Error(`Missing initial font face: ${initialFontId}`);
  return `/* ${initialFontId} */\n${match[1]}\n`;
}

function resolveRawCssImport(source: string, importer: string): string {
  if (source === '@emdash/theme/styles.css') return themeStylesPath;
  if (source === '@fontsource-variable/jetbrains-mono/index.css') return fontStylesPath;
  if (source.startsWith('.')) return resolve(dirname(importer), source);
  return require.resolve(source);
}

function fontArtifact(sourcePath: string): FontArtifact {
  const id = basename(sourcePath, extname(sourcePath));
  const subsetMatch = id.match(/jetbrains-mono-([a-z-]+)-wght-(normal|italic)$/);
  if (!subsetMatch) throw new Error(`Unrecognized WOFF2 artifact: ${sourcePath}`);
  return {
    bytes: statSync(sourcePath).size,
    family: 'JetBrains Mono Variable',
    file: `fonts/${basename(sourcePath)}`,
    id,
    initial: id === initialFontId,
    sourcePath,
    style: subsetMatch[2],
    subset: subsetMatch[1],
    weight: '100 800',
  };
}

function inlineRawCss(roots: readonly string[]): {
  readonly css: string;
  readonly fonts: readonly FontArtifact[];
} {
  const visited = new Set<string>();
  const fonts = new Map<string, FontArtifact>();

  function inlineFile(path: string): string {
    const canonicalPath = resolve(path);
    if (visited.has(canonicalPath)) return '';
    visited.add(canonicalPath);

    let css = readFileSync(canonicalPath, 'utf8');
    if (canonicalPath === fontStylesPath) css = extractInitialFontFace(css);

    css = css.replace(
      /url\(\s*(['"]?)([^'")]+)\1\s*\)/g,
      (rule, _quote: string, source: string) => {
        if (/^(?:data:|https?:|#)/.test(source)) return rule;
        const assetPath = resolve(dirname(canonicalPath), source);
        if (extname(assetPath) !== '.woff2') {
          throw new Error(`Unsupported local CSS asset: ${source} in ${canonicalPath}`);
        }
        const artifact = fontArtifact(assetPath);
        fonts.set(artifact.id, artifact);
        return `url("./${artifact.file}")`;
      }
    );
    css = css.replace(
      /@import\s+(?:url\(\s*)?(['"])([^'"]+)\1\s*\)?\s*;/g,
      (_rule, _quote: string, source: string) =>
        inlineFile(resolveRawCssImport(source, canonicalPath))
    );
    return css;
  }

  return {
    css: roots.map(inlineFile).join('\n'),
    fonts: [...fonts.values()].sort((left, right) => compareText(left.id, right.id)),
  };
}

function toCssText(asset: OutputAsset): string {
  return typeof asset.source === 'string'
    ? asset.source
    : Buffer.from(asset.source).toString('utf8');
}

function budget(bytes: number, limit: number) {
  return { bytes, limit, withinLimit: bytes <= limit };
}

function canonicalLayerPrelude(): string {
  const source = readFileSync(canonicalLayersPath, 'utf8');
  const names = [...source.matchAll(/:\s*'([^']+)'/g)].map(([, name]) => name);
  if (names.length === 0) throw new Error('Canonical layer declaration has no layer names');
  return `@layer ${names.join(',')};`;
}

function sentinelResults(css: string): Readonly<Record<string, boolean>> {
  return {
    base: css.includes('scrollbar-width:thin'),
    canonicalLayers:
      /@layer emdash\.vendor,\s*emdash\.reset,\s*emdash\.tokens,\s*emdash\.base,\s*emdash\.recipes,\s*emdash\.utilities,\s*emdash\.host/.test(
        css
      ),
    component: css.includes('vertical-align:baseline'),
    effects: css.includes('@keyframes accordion-down'),
    fontFace: css.includes('@font-face'),
    pattern: css.includes('grid-template-columns:var(--_collection-view-template)'),
    primitive: css.includes('button__'),
    reset: css.includes('box-sizing:border-box'),
    theme: css.includes('--em-neutral-1:'),
    utilities: /@layer emdash\.utilities\{[^{}]*\{[^}]/.test(css),
  };
}

function unresolvedImports(css: string): string[] {
  const imports = [...css.matchAll(/@import\s+[^;]+;/g)].map(([value]) => value);
  const packageReferences = [...css.matchAll(/(?:@emdash\/|@fontsource)[^'")\s;]*/g)].map(
    ([value]) => value
  );
  return [...new Set([...imports, ...packageReferences])].sort(compareText);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function buildStyles(): Promise<void> {
  const vanillaExtractFiles = walkFiles(sourceRoot, isProductionVanillaExtractFile);
  const rawCssFiles = walkFiles(sourceRoot, (path) => path.endsWith('.css'));
  const { css: rawCss, fonts } = inlineRawCss([themeStylesPath, ...rawCssFiles]);

  const bundle = await rollup({
    external(id) {
      if (id.includes('.vanilla.css')) return false;
      return (
        !id.startsWith('.') &&
        !id.startsWith('/') &&
        !id.startsWith('\0') &&
        !id.match(/\.css(?:\.ts)?$/)
      );
    },
    input: virtualEntryId,
    onwarn(warning: RollupLog) {
      throw new Error(warning.message);
    },
    plugins: [
      aggregateEntryPlugin(vanillaExtractFiles, rawCssFiles),
      vanillaExtractPlugin({
        cwd: packageRoot,
        esbuildOptions: {
          conditions: ['development'],
          tsconfig: resolve(packageRoot, 'tsconfig.json'),
        },
        extract: {
          name: 'styles.css',
          sourcemap: false,
        },
        identifiers: 'debug',
      }),
    ],
    treeshake: false,
  });

  try {
    const generated = await bundle.generate({
      assetFileNames: '[name][extname]',
      format: 'es',
    });
    const cssAssets = generated.output.filter(
      (entry): entry is OutputAsset => entry.type === 'asset' && entry.fileName.endsWith('.css')
    );
    if (cssAssets.length !== 1) {
      throw new Error(`Expected one Vanilla Extract CSS asset, received ${cssAssets.length}`);
    }

    const combinedCss = `${toCssText(cssAssets[0])}\n${rawCss}`;
    const transformed = Buffer.from(
      transform({
        code: Buffer.from(combinedCss),
        filename: 'styles.css',
        minify: true,
      }).code
    );
    const minified = Buffer.concat([Buffer.from(canonicalLayerPrelude()), transformed]);
    const gzipBytes = gzipSync(minified, { level: 9 }).byteLength;
    const totalFontBytes = fonts.reduce((total, font) => total + font.bytes, 0);
    const initialFont = fonts.find((font) => font.initial);
    if (!initialFont) throw new Error(`Initial font subset was not emitted: ${initialFontId}`);

    mkdirSync(outputRoot, { recursive: true });
    for (const file of readdirSync(outputRoot)) {
      if (file.endsWith('.css') || file.endsWith('.css.map')) {
        rmSync(resolve(outputRoot, file), { force: true });
      }
    }
    rmSync(fontsOutputRoot, { force: true, recursive: true });
    mkdirSync(fontsOutputRoot, { recursive: true });
    writeFileSync(resolve(outputRoot, 'styles.css'), minified);
    for (const font of fonts) {
      copyFileSync(font.sourcePath, resolve(outputRoot, font.file));
    }

    const fontManifest = {
      fonts: fonts.map(({ sourcePath: _sourcePath, ...font }) => font),
      initialSubset: initialFontId,
      version: 1,
    };
    writeFileSync(
      resolve(outputRoot, 'styles.fonts.json'),
      `${JSON.stringify(fontManifest, null, 2)}\n`
    );

    const budgets = {
      gzipCss: budget(gzipBytes, budgetLimits.gzipCss),
      initialSubset: budget(initialFont.bytes, budgetLimits.initialSubset),
      rawCss: budget(minified.byteLength, budgetLimits.rawCss),
      totalWoff2: budget(totalFontBytes, budgetLimits.totalWoff2),
    };
    const sentinels = sentinelResults(minified.toString('utf8'));
    const unresolved = unresolvedImports(minified.toString('utf8'));
    const unlayeredRules = unlayeredRuleHeaders(minified.toString('utf8'));
    const cssFiles = readdirSync(outputRoot)
      .filter((file) => file.endsWith('.css'))
      .sort(compareText);
    const report = {
      artifact: 'styles.css',
      budgets,
      loading: {
        cssFiles,
        sentinels,
        unlayeredRules,
        unresolvedImports: unresolved,
      },
      version: 1,
    };
    writeFileSync(
      resolve(outputRoot, 'styles.report.json'),
      `${JSON.stringify(report, null, 2)}\n`
    );

    console.log(
      `styles.css ${minified.byteLength} B raw, ${gzipBytes} B gzip-9; WOFF2 ${totalFontBytes} B (${initialFont.bytes} B initial)`
    );

    const failures = [
      ...Object.entries(budgets)
        .filter(([, result]) => !result.withinLimit)
        .map(
          ([name, result]) =>
            `${name} budget exceeded: ${result.bytes} bytes > ${result.limit} bytes`
        ),
      ...Object.entries(sentinels)
        .filter(([, present]) => !present)
        .map(([name]) => `missing aggregate sentinel: ${name}`),
      ...unlayeredRules.map((header) => `unlayered top-level CSS rule: ${header}`),
      ...unresolved.map((entry) => `unresolved CSS import/reference: ${entry}`),
    ];
    if (cssFiles.length !== 1 || cssFiles[0] !== 'styles.css') {
      failures.push(`expected only styles.css, emitted: ${cssFiles.join(', ') || '<none>'}`);
    }
    if (fonts.filter((font) => font.initial).length !== 1 || initialFont.subset !== 'latin') {
      failures.push('expected exactly one initial Latin WOFF2 subset');
    }
    if (failures.length > 0) {
      throw new Error(`@emdash/ui stylesheet gate failed:\n${failures.join('\n')}`);
    }
  } finally {
    await bundle.close();
  }
}

await buildStyles();
