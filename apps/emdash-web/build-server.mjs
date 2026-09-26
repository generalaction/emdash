import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Builds the Emdash web server:
 *   dist/server.js              — the boot + HTTP/WS server bundle
 *   dist/app/out/main/*.js      — runtime worker bundles (forked child processes)
 *
 * The `electron` module is aliased to a shim so the desktop backend code
 * boots under plain Node. Workspace packages and desktop sources are bundled
 * in; native modules stay external.
 */
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, '../emdash-desktop');
const repoRoot = resolve(here, '../..');
const distDir = join(here, 'dist');

const ALIASES = {
  electron: join(here, 'server/shim/electron.ts'),
  '@core': join(desktopRoot, 'src/core'),
  '@main': join(desktopRoot, 'src/main'),
  '@renderer': join(desktopRoot, 'src/renderer'),
  '@root': desktopRoot,
  '@web': join(here, 'web'),
  '@': join(desktopRoot, 'src'),
};

const EXTERNAL = ['better-sqlite3', 'node-pty', 'ssh2', 'cpu-features', 'ws'];

/** Vite-style `?asset` imports (tray icons etc.) resolve to their file path. */
const assetQueryPlugin = {
  name: 'emdash-web-asset-query',
  setup(build) {
    build.onResolve({ filter: /\?asset$/ }, (args) => ({
      path: args.path.replace(/\?asset$/, ''),
      namespace: 'asset-path',
    }));
    build.onLoad({ filter: /.*/, namespace: 'asset-path' }, (args) => ({
      contents: `module.exports = ${JSON.stringify(args.path)}`,
      loader: 'js',
    }));
  },
};

/**
 * packages/core Node subpath imports (`#runtimes/*` etc.). When bundling core
 * sources directly, esbuild does not apply the package `imports` fallback
 * chains, so replicate them: exact, `.ts`, and `/index.ts`.
 */
/**
 * Vite `import.meta.glob(..., { query: '?raw', eager: true })` — used to inline
 * drizzle migration SQL at build time. Expands the glob into an object literal
 * of file contents so esbuild can bundle it.
 */
const importMetaGlobPlugin = {
  name: 'emdash-web-import-meta-glob',
  setup(build) {
    build.onLoad({ filter: /\.(ts|tsx|js|jsx)$/ }, async (args) => {
      if (args.path.includes('node_modules')) return undefined;
      const source = readFileSync(args.path, 'utf8');
      if (!source.includes('import.meta.glob')) return undefined;
      const re = /import\.meta\.glob\(\s*'([^']+)'\s*,\s*\{[^}]*\}\s*\)/g;
      let changed = false;
      const code = source.replace(re, (full, pattern) => {
        const baseDir = pattern.startsWith('@root/')
          ? desktopRoot
          : pattern.startsWith('@core/')
            ? join(desktopRoot, 'src/core')
            : dirname(args.path);
        const globDir = resolve(
          baseDir,
          pattern.replace(/^@(root|core)\//, '').replace(/\/[^/]*\*[^/]*$/, '')
        );
        const suffix = pattern.split('/').pop();
        if (!suffix || !suffix.includes('*')) return full;
        const ext = suffix.replace(/^[^.]*\*/, '');
        if (!ext) return full;
        const files = existsSync(globDir)
          ? readdirSync(globDir)
              .filter((f) => f.endsWith(ext))
              .sort()
          : [];
        changed = true;
        const entries = files.map((f) => {
          const content = readFileSync(join(globDir, f), 'utf8');
          return `${JSON.stringify(`./${f}`)}: ${JSON.stringify(content)}`;
        });
        return `({ ${entries.join(', ')} })`;
      });
      if (!changed) return undefined;
      return { contents: code, loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts' };
    });
  },
};

const corePkgSrc = resolve(repoRoot, 'packages/core/src');
const coreHashImportsPlugin = {
  name: 'emdash-web-core-hash-imports',
  setup(build) {
    build.onResolve({ filter: /^#(runtimes|services|primitives|workspace-server)\// }, (args) => {
      if (!args.resolveDir) return undefined;
      const match = args.path.match(/^#(runtimes|services|primitives|workspace-server)\/(.*)$/);
      if (!match) return undefined;
      const base = join(corePkgSrc, match[1], match[2]);
      for (const candidate of [base, `${base}.ts`, join(base, 'index.ts'), `${base}.tsx`]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          return { path: candidate };
        }
      }
      return undefined;
    });
  },
};

/** Bundle the workers manifest to CJS so we can read it from plain node. */
async function loadWorkerManifest() {
  const tmp = join(distDir, 'workers-manifest.tmp.cjs');
  await build({
    entryPoints: [join(desktopRoot, 'src/core/manifests/node/workers.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: tmp,
    logLevel: 'silent',
    alias: ALIASES,
    define: {
      'import.meta.env': '{"DEV":false,"PROD":true,"MODE":"production"}',
    },
    external: EXTERNAL,
    plugins: [assetQueryPlugin, coreHashImportsPlugin, importMetaGlobPlugin],
  });
  const mod = await import(`${tmp}?t=${Date.now()}`);
  rmSync(tmp, { force: true });
  return mod.desktopWorkers;
}

async function main() {
  // Preserve dist/web (renderer build); only rebuild server + worker artifacts.
  rmSync(join(distDir, 'app'), { recursive: true, force: true });
  rmSync(join(distDir, 'server.js'), { force: true });
  mkdirSync(join(distDir, 'app/out/main'), { recursive: true });

  console.log('[emdash-web] building server bundle…');
  await build({
    entryPoints: [join(here, 'server/index.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: join(distDir, 'server.js'),
    alias: ALIASES,
    define: {
      'import.meta.env': '{"DEV":false,"PROD":true,"MODE":"production"}',
    },
    external: EXTERNAL,
    plugins: [assetQueryPlugin, coreHashImportsPlugin, importMetaGlobPlugin],
    sourcemap: true,
    legalComments: 'none',
    logLevel: 'info',
    banner: {
      js: [
        'import { createRequire as __emdashWebCreateRequire } from "node:module";',
        'const require = __emdashWebCreateRequire(import.meta.url);',
      ].join('\n'),
    },
  });

  console.log('[emdash-web] building worker bundles…');
  const workers = await loadWorkerManifest();
  const entries = {};
  for (const worker of Object.values(workers)) {
    const name = basename(worker.file, extname(worker.file));
    // Manifest entries resolve against the desktop app root, matching
    // electron-vite's `resolve(worker.entry)` from apps/emdash-desktop.
    const entry = resolve(desktopRoot, worker.entry);
    entries[name] = entry;
  }

  await build({
    entryPoints: entries,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outdir: join(distDir, 'app/out/main'),
    entryNames: '[name]',
    alias: ALIASES,
    define: {
      'import.meta.env': '{"DEV":false,"PROD":true,"MODE":"production"}',
    },
    external: EXTERNAL,
    plugins: [assetQueryPlugin, coreHashImportsPlugin, importMetaGlobPlugin],
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'info',
  });

  // The worker path resolver expects out/main under the shimmed app path.
  writeFileSync(
    join(distDir, 'app/package.json'),
    JSON.stringify({ name: 'emdash-web-app', private: true }, null, 2)
  );

  console.log(`[emdash-web] done: ${Object.keys(entries).length} workers + server.js`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
