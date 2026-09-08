import fs from 'node:fs';
import path from 'node:path';

export const STYLING_RULE_NAMES = [
  'host-adapter-boundaries',
  'no-important',
  'no-legacy-visual-properties',
  'recipe-utility-conflicts',
  'rooted-global-adapters',
  'styling-import-boundaries',
  'styling-layer-boundaries',
];

export const DEFAULT_REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
export const DEFAULT_MANIFEST_DIR = path.resolve(import.meta.dirname, '../allowlists/styling');
export const DEFAULT_REGISTRY_DIR = path.resolve(import.meta.dirname, '../registries');

export const stylingRuleSchema = [
  {
    type: 'object',
    properties: {
      repoRoot: { type: 'string' },
      uiRoot: { type: 'string' },
      desktopRoot: { type: 'string' },
      manifestDir: { type: 'string' },
      registryDir: { type: 'string' },
    },
    additionalProperties: false,
  },
];

export function getFilename(context) {
  return context.filename ?? context.getFilename?.() ?? context.physicalFilename ?? '';
}

export function getStylingOptions(context) {
  const [configured] = context.options ?? [];
  const options = configured && typeof configured === 'object' ? configured : {};
  const repoRoot = path.resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
  return {
    repoRoot,
    uiRoot: path.resolve(options.uiRoot ?? path.join(repoRoot, 'packages/ui/src')),
    desktopRoot: path.resolve(
      options.desktopRoot ?? path.join(repoRoot, 'apps/emdash-desktop/src')
    ),
    manifestDir: path.resolve(options.manifestDir ?? DEFAULT_MANIFEST_DIR),
    registryDir: path.resolve(options.registryDir ?? DEFAULT_REGISTRY_DIR),
  };
}

export function normalizePath(value) {
  return value.replaceAll('\\', '/');
}

export function absoluteFilename(filename, repoRoot) {
  return path.resolve(repoRoot, normalizePath(filename));
}

export function isWithin(filePath, root) {
  const relative = path.relative(root, filePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function isUiFile(filename, options) {
  return isWithin(absoluteFilename(filename, options.repoRoot), options.uiRoot);
}

export function isStylingCssTsFile(filename, options) {
  if (!filename.endsWith('.css.ts')) return false;
  const absolute = absoluteFilename(filename, options.repoRoot);
  return isWithin(absolute, options.uiRoot) || isWithin(absolute, options.desktopRoot);
}

export function literalValue(node) {
  return typeof node?.value === 'string' ? node.value : undefined;
}

export function propertyName(node) {
  if (!node || node.computed) return undefined;
  return literalValue(node.key) ?? (node.key?.type === 'Identifier' ? node.key.name : undefined);
}

export function importSource(node) {
  return literalValue(node.source) ?? literalValue(node.arguments?.[0]);
}

export function loadRegistryModules(name, options) {
  const registryPath = path.join(options.registryDir, `${name}.json`);
  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    if (!Array.isArray(parsed.modules)) return new Set();
    return new Set(
      parsed.modules.map((entry) =>
        normalizePath(
          path.relative(
            options.repoRoot,
            path.isAbsolute(entry) ? path.resolve(entry) : path.resolve(options.repoRoot, entry)
          )
        )
      )
    );
  } catch (error) {
    if (error?.code === 'ENOENT') return new Set();
    throw error;
  }
}

export function isRegisteredModule(filename, modules, options) {
  const relative = normalizePath(
    path.relative(options.repoRoot, absoluteFilename(filename, options.repoRoot))
  );
  return modules.has(relative);
}

export function createStylingReporter(context, ruleName, options) {
  const filename = getFilename(context);
  const relativeFilename = normalizePath(
    path.relative(options.repoRoot, absoluteFilename(filename, options.repoRoot))
  );
  const allowedIds = loadAllowedIds(ruleName, options);
  const counts = new Map();

  return (node, kind, detail, message) => {
    const encodedDetail = encodeURIComponent(detail);
    const countKey = `${kind}:${encodedDetail}`;
    const ordinal = (counts.get(countKey) ?? 0) + 1;
    counts.set(countKey, ordinal);
    const localId = `${kind}:${encodedDetail}:${ordinal}`;
    const id = `${relativeFilename}::${localId}`;
    if (allowedIds.has(id)) return;

    context.report({
      node,
      messageId: 'violation',
      data: {
        message: `${message} [emdash-styling:${localId}]`,
      },
    });
  };
}

function loadAllowedIds(ruleName, options) {
  if (process.env.EMDASH_DISABLE_STYLING_ALLOWLISTS === '1') return new Set();
  const manifestPath = path.join(options.manifestDir, `${ruleName}.json`);
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return new Set([
      ...(Array.isArray(parsed.violations) ? parsed.violations : []),
      ...(Array.isArray(parsed.exceptions)
        ? parsed.exceptions.map((entry) => entry?.id).filter(Boolean)
        : []),
    ]);
  } catch (error) {
    if (error?.code === 'ENOENT') return new Set();
    throw error;
  }
}

export function stylingRuleMeta() {
  return {
    type: 'problem',
    messages: {
      violation: '{{message}}',
    },
    schema: stylingRuleSchema,
  };
}
