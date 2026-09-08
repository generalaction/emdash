import fs from 'node:fs';
import path from 'node:path';
import {
  findCssCompatibilityProblems,
  findForbiddenThemeProductPaths,
  findHostEntrypointProblems,
  findIntegrationCoverageGaps,
  findProfileParityMismatches,
  findTailwindAliasProblems,
} from './convergence.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const config = readJson(path.join(import.meta.dirname, 'config.json'));
const failures = [];

if (config.hostEntrypoints.active) {
  for (const entry of config.hostEntrypoints.entries) {
    if (!entry.hostStylesheet) {
      failures.push(`host entrypoint ${entry.name}: hostStylesheet must be configured`);
      continue;
    }
    const source = fs.readFileSync(path.join(repoRoot, entry.entry), 'utf8');
    for (const problem of findHostEntrypointProblems(source, entry.hostStylesheet)) {
      failures.push(`host entrypoint ${entry.name}: ${problem}`);
    }
  }
}

if (config.cssCompatibilityRemoval.active) {
  const packageJson = readConfiguredJson(
    config.cssCompatibilityRemoval.packageJson,
    'UI package manifest'
  );
  const cssExports = Object.fromEntries(
    Object.entries(packageJson.exports).filter(
      ([exportPath, target]) =>
        exportPath.endsWith('.css') || (typeof target === 'string' && target.endsWith('.css'))
    )
  );
  const existingForbiddenFiles = config.cssCompatibilityRemoval.forbiddenFiles.filter(
    (relativePath) => fs.existsSync(path.join(repoRoot, relativePath))
  );
  const retiredSpecifiers = new Set(config.cssCompatibilityRemoval.retiredSpecifiers);
  const retiredReferences = config.cssCompatibilityRemoval.scanRoots.flatMap((root) =>
    walkProductionFiles(path.join(repoRoot, root)).flatMap((filePath) => {
      const source = fs.readFileSync(filePath, 'utf8');
      return [...source.matchAll(/(?:\bimport|@import)\s+(?:url\(\s*)?['"]([^'"]+)['"]/g)]
        .map((match) => match[1])
        .filter((specifier) => retiredSpecifiers.has(specifier))
        .map((specifier) => `${path.relative(repoRoot, filePath)}: ${specifier}`);
    })
  );

  for (const problem of findCssCompatibilityProblems({
    canonicalExport: config.cssCompatibilityRemoval.canonicalExport,
    canonicalTarget: config.cssCompatibilityRemoval.canonicalTarget,
    cssExports,
    existingForbiddenFiles,
    retiredReferences,
  })) {
    failures.push(`CSS compatibility removal: ${problem}`);
  }
}

if (config.profileParity.active) {
  const bootstrap = readConfiguredJson(
    config.profileParity.bootstrapManifest,
    'bootstrap manifest'
  );
  const provider = readConfiguredJson(config.profileParity.providerManifest, 'provider manifest');
  for (const mismatch of findProfileParityMismatches(bootstrap, provider)) {
    failures.push(`profile parity: ${mismatch}`);
  }
}

if (config.integrationManifestCoverage.active) {
  for (const manifest of config.integrationManifestCoverage.manifests) {
    const definitions = readConfiguredJson(manifest.path, `${manifest.name} integration manifest`);
    for (const gap of findIntegrationCoverageGaps(definitions)) {
      failures.push(`${manifest.name} integration manifest: ${gap}`);
    }
  }
}

if (config.themeProductPathRemoval.active) {
  const tokens = readConfiguredJson(
    config.themeProductPathRemoval.tokenManifest,
    'Theme Token manifest'
  );
  for (const tokenPath of findForbiddenThemeProductPaths(
    tokens,
    config.themeProductPathRemoval.forbiddenPaths
  )) {
    failures.push(`Theme product path remains: ${tokenPath}`);
  }
}

if (config.tailwindAliasConvergence.active) {
  const source = fs.readFileSync(
    path.join(repoRoot, config.tailwindAliasConvergence.stylesheet),
    'utf8'
  );
  for (const problem of findTailwindAliasProblems(source)) {
    failures.push(`Tailwind alias convergence: ${problem}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

const activeCount = Object.values(config).filter((check) => check.active).length;
console.log(
  `check-styling-convergence: ${activeCount} active, ${
    Object.keys(config).length - activeCount
  } staged.`
);

function readConfiguredJson(relativePath, label) {
  if (!relativePath) throw new Error(`${label} must be configured before activation`);
  return readJson(path.resolve(repoRoot, relativePath));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function walkProductionFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__fixtures__' || entry.name === 'test-fixtures'
        ? []
        : walkProductionFiles(filePath);
    }
    if (/\.(?:test|stories)\.[cm]?[jt]sx?$/.test(entry.name)) return [];
    return /\.(?:css|html|[cm]?[jt]sx?)$/.test(entry.name) ? [filePath] : [];
  });
}
