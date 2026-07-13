import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_TYPES = new Set(['runtimes', 'services', 'primitives']);
const ALIAS_PREFIXES = {
  '@runtimes/': 'runtimes',
  '@services/': 'services',
  '@primitives/': 'primitives',
};
const CORE_PACKAGE_PREFIX = '@emdash/core/';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CORE_SRC_ROOT = path.resolve(currentDir, '../../../packages/core/src');

export function normalizePath(value) {
  return value.replaceAll('\\', '/');
}

function normalizeAbsolute(value) {
  return normalizePath(path.resolve(normalizePath(value)));
}

export function classifyCorePath(filePath, coreSrcRoot = DEFAULT_CORE_SRC_ROOT) {
  const normalizedFile = normalizeAbsolute(filePath);
  const normalizedRoot = normalizeAbsolute(coreSrcRoot);
  if (normalizedFile !== normalizedRoot && !normalizedFile.startsWith(`${normalizedRoot}/`)) {
    return undefined;
  }

  const relative = normalizePath(path.relative(normalizedRoot, normalizedFile));
  const [type, moduleName] = relative.split('/');
  if (!MODULE_TYPES.has(type) || !moduleName) return undefined;
  return {
    type,
    moduleName,
  };
}

export function classifyImportSpecifier(specifier, fromFile, coreSrcRoot = DEFAULT_CORE_SRC_ROOT) {
  if (!specifier || typeof specifier !== 'string') return undefined;

  for (const [prefix, type] of Object.entries(ALIAS_PREFIXES)) {
    if (!specifier.startsWith(prefix)) continue;
    const rest = specifier.slice(prefix.length);
    const [moduleName] = rest.split('/');
    if (!moduleName) return undefined;
    return { type, moduleName };
  }

  if (specifier.startsWith(CORE_PACKAGE_PREFIX)) {
    const rest = specifier.slice(CORE_PACKAGE_PREFIX.length);
    const [type, moduleName] = rest.split('/');
    if (!MODULE_TYPES.has(type) || !moduleName) return undefined;
    return { type, moduleName };
  }

  if (specifier.startsWith('.')) {
    const target = path.resolve(path.dirname(fromFile), specifier);
    return classifyCorePath(target, coreSrcRoot);
  }

  return undefined;
}

export function isAllowedCoreModuleDependency(source, target) {
  if (!source || !target) return true;
  if (source.type === target.type && source.moduleName === target.moduleName) return true;

  if (source.type === 'runtimes') {
    return target.type === 'services' || target.type === 'primitives';
  }

  if (source.type === 'services') {
    return target.type === 'primitives';
  }

  if (source.type === 'primitives') {
    return target.type === 'primitives';
  }

  return true;
}

export function dependencyMessage(source, target, specifier) {
  return `${source.type}/${source.moduleName} must not import ${target.type}/${
    target.moduleName
  } via '${specifier}'. Allowed Core module dependencies are: runtimes -> services/primitives, services -> primitives, primitives -> primitives.`;
}

function getFilename(context) {
  return context.filename ?? context.getFilename?.() ?? context.physicalFilename ?? '';
}

function getOptions(context) {
  const [options] = context.options ?? [];
  return options && typeof options === 'object' ? options : {};
}

function literalValue(node) {
  const value = node?.value;
  return typeof value === 'string' ? value : undefined;
}

function importExpressionSource(node) {
  return literalValue(node.source) ?? literalValue(node.arguments?.[0]);
}

function checkImport(context, node, specifier, sourceModule, coreSrcRoot) {
  if (!specifier) return;
  const filename = getFilename(context);
  if (!filename) return;
  const targetModule = classifyImportSpecifier(specifier, filename, coreSrcRoot);
  if (!targetModule || isAllowedCoreModuleDependency(sourceModule, targetModule)) return;

  context.report({
    node,
    messageId: 'forbiddenDependency',
    data: {
      message: dependencyMessage(sourceModule, targetModule, specifier),
    },
  });
}

export const coreModuleBoundariesRule = {
  meta: {
    type: 'problem',
    messages: {
      forbiddenDependency: '{{message}}',
    },
    schema: [
      {
        type: 'object',
        properties: {
          coreSrcRoot: {
            type: 'string',
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options = getOptions(context);
    const coreSrcRoot = options.coreSrcRoot
      ? path.resolve(options.coreSrcRoot)
      : DEFAULT_CORE_SRC_ROOT;
    const filename = getFilename(context);
    const sourceModule = filename ? classifyCorePath(filename, coreSrcRoot) : undefined;
    if (!sourceModule) return {};

    return {
      ImportDeclaration(node) {
        checkImport(context, node, literalValue(node.source), sourceModule, coreSrcRoot);
      },
      ExportNamedDeclaration(node) {
        checkImport(context, node, literalValue(node.source), sourceModule, coreSrcRoot);
      },
      ExportAllDeclaration(node) {
        checkImport(context, node, literalValue(node.source), sourceModule, coreSrcRoot);
      },
      ImportExpression(node) {
        checkImport(context, node, importExpressionSource(node), sourceModule, coreSrcRoot);
      },
    };
  },
};
