import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { vanillaExtractPlugin } from '@vanilla-extract/rollup-plugin';
import { rollup } from 'rollup';
import type { Plugin } from 'rollup';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const packageRoot = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(packageRoot, 'src');
const outputRoot = resolve(packageRoot, 'dist');

const entries = {
  react: resolve(sourceRoot, 'react/index.ts'),
  'react/chat-ui': resolve(sourceRoot, 'react/chat-ui/index.ts'),
  'react/components': resolve(sourceRoot, 'react/components/index.ts'),
  'react/form': resolve(sourceRoot, 'react/patterns/form/index.ts'),
  'react/patterns': resolve(sourceRoot, 'react/patterns/index.ts'),
  'react/primitives': resolve(sourceRoot, 'react/primitives/index.ts'),
  'react/theme-runtime': resolve(sourceRoot, 'react/theme-runtime.tsx'),
  styles: resolve(sourceRoot, 'styles/index.ts'),
  'styles/host': resolve(sourceRoot, 'styles/host.ts'),
  'styles/recipes/control': resolve(sourceRoot, 'styles/recipes/control.ts'),
  'styles/recipes/field-control': resolve(sourceRoot, 'styles/recipes/field-control.ts'),
  'styles/recipes/menu-item': resolve(sourceRoot, 'styles/recipes/menu-item.ts'),
  'styles/recipes/surface': resolve(sourceRoot, 'styles/recipes/surface.ts'),
} as const;

const aliases = new Map([
  ['@react', resolve(sourceRoot, 'react')],
  ['@styles', resolve(sourceRoot, 'styles')],
  ['@', sourceRoot],
]);

const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.css.ts'] as const;

function resolveSource(candidate: string): string | undefined {
  if (existsSync(candidate) && extname(candidate) !== '') return candidate;
  for (const extension of sourceExtensions) {
    if (existsSync(`${candidate}${extension}`)) return `${candidate}${extension}`;
  }
  for (const extension of sourceExtensions) {
    const indexPath = resolve(candidate, `index${extension}`);
    if (existsSync(indexPath)) return indexPath;
  }
  return undefined;
}

function resolveAlias(source: string): string | undefined {
  for (const [alias, replacement] of aliases) {
    if (source === alias) return resolveSource(replacement);
    if (source.startsWith(`${alias}/`)) {
      return resolveSource(resolve(replacement, source.slice(alias.length + 1)));
    }
  }
  return undefined;
}

function sourceResolver(): Plugin {
  return {
    name: 'emdash-ui-source-resolver',
    resolveId(source, importer) {
      const aliased = resolveAlias(source);
      if (aliased) return aliased;
      if (!importer || !source.startsWith('.')) return null;
      return resolveSource(resolve(dirname(importer), source)) ?? null;
    },
  };
}

function typescriptTranspiler(): Plugin {
  return {
    name: 'emdash-ui-typescript',
    transform(code, id) {
      if (!id.startsWith(sourceRoot) || !/\.[cm]?[jt]sx?$/.test(id)) return null;
      const result = ts.transpileModule(code, {
        compilerOptions: {
          importHelpers: false,
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          sourceMap: true,
          target: ts.ScriptTarget.ES2022,
        },
        fileName: id,
      });
      return {
        code: result.outputText,
        map: result.sourceMapText ? JSON.parse(result.sourceMapText) : null,
      };
    },
  };
}

function omitExtractedCss(): Plugin {
  const removeStylesheetImports = (code: string): string =>
    code.replace(/^import\s+['"][^'"]+\.css(?:\?[^'"]*)?['"];\n/gm, '');

  return {
    name: 'emdash-ui-omit-library-css',
    renderChunk(code) {
      const runtimeCode = removeStylesheetImports(code);
      return runtimeCode === code ? null : { code: runtimeCode, map: null };
    },
    generateBundle(_options, bundle) {
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type === 'chunk') {
          output.code = removeStylesheetImports(output.code);
          output.imports = output.imports.filter((specifier) => !specifier.endsWith('.css'));
        } else if (fileName.endsWith('.css')) {
          delete bundle[fileName];
        }
      }
    },
  };
}

function walkDeclarations(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    return entry.isDirectory() ? walkDeclarations(path) : path.endsWith('.d.ts') ? [path] : [];
  });
}

function declarationAliasTarget(source: string): string | undefined {
  for (const [alias, replacement] of aliases) {
    if (source === alias) return replacement;
    if (source.startsWith(`${alias}/`)) {
      return resolve(replacement, source.slice(alias.length + 1));
    }
  }
  return undefined;
}

function rewriteDeclarationAliases(): void {
  const declarationRoot = resolve(outputRoot, 'src');
  for (const declarationPath of walkDeclarations(declarationRoot)) {
    const source = readFileSync(declarationPath, 'utf8');
    const rewritten = source.replace(
      /(['"])(@(?:react|styles)(?:\/[^'"]*)?|@\/[^'"]+)\1/g,
      (match, quote: string, specifier: string) => {
        const target = declarationAliasTarget(specifier);
        if (!target) return match;
        const outputTarget = resolve(declarationRoot, relative(sourceRoot, target));
        let rewrittenSpecifier = relative(dirname(declarationPath), outputTarget)
          .split(sep)
          .join('/');
        if (!rewrittenSpecifier.startsWith('.')) rewrittenSpecifier = `./${rewrittenSpecifier}`;
        return `${quote}${rewrittenSpecifier}${quote}`;
      }
    );
    if (rewritten !== source) writeFileSync(declarationPath, rewritten);
  }
}

async function buildLibrary(): Promise<void> {
  rmSync(outputRoot, { force: true, recursive: true });

  const bundle = await rollup({
    input: entries,
    external(source) {
      if (source.includes('.vanilla.css')) return false;
      return !source.startsWith('.') && !source.startsWith('/') && !resolveAlias(source);
    },
    onwarn(warning, warn) {
      if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
      warn(warning);
    },
    plugins: [
      sourceResolver(),
      vanillaExtractPlugin({
        cwd: packageRoot,
        esbuildOptions: {
          conditions: ['development'],
          tsconfig: resolve(packageRoot, 'tsconfig.json'),
        },
        identifiers: 'debug',
      }),
      typescriptTranspiler(),
      omitExtractedCss(),
    ],
    treeshake: true,
  });

  try {
    await bundle.write({
      chunkFileNames: 'chunks/[name]-[hash].js',
      entryFileNames: '[name].js',
      format: 'es',
      dir: outputRoot,
      sourcemap: false,
    });
  } finally {
    await bundle.close();
  }

  const typescriptCli = require.resolve('typescript/bin/tsc');
  execFileSync(
    process.execPath,
    [typescriptCli, '--project', resolve(packageRoot, 'tsconfig.build.json')],
    {
      cwd: packageRoot,
      stdio: 'inherit',
    }
  );
  rewriteDeclarationAliases();
}

await buildLibrary();
