import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_REPO_ROOT = path.resolve(currentDir, '../../..');
const DEFAULT_ALLOWLIST_PATH = path.join(currentDir, '../allowlists/legacy-ui-kit.json');

const LEGACY_KIT_PREFIX = '@core/primitives/ui/browser';

const LEGACY_KIT_MESSAGE =
  `Imports from '${LEGACY_KIT_PREFIX}' are banned: the legacy UI kit is being retired by the ` +
  `UI-kit unification migration. Use @emdash/ui (or '@core/primitives/styling/browser/cn' for cn) ` +
  `instead. Existing importers are grandfathered in tooling/oxlint/allowlists/legacy-ui-kit.json; ` +
  `do not add new entries.`;

function isLegacyKitImport(specifier) {
  return specifier === LEGACY_KIT_PREFIX || specifier.startsWith(`${LEGACY_KIT_PREFIX}/`);
}

function loadAllowlist(allowlistPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
    return Array.isArray(parsed.files) ? parsed.files : [];
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function isAllowlisted(filename, entries, repoRoot) {
  if (!filename || entries.length === 0) return false;
  const normalized = path.resolve(filename).replaceAll('\\', '/');
  return entries.some(
    (entry) =>
      path
        .resolve(path.isAbsolute(entry) ? entry : path.join(repoRoot, entry))
        .replaceAll('\\', '/') === normalized
  );
}

function literalValue(node) {
  const value = node?.value;
  return typeof value === 'string' ? value : undefined;
}

function checkSource(context, node, specifier) {
  if (!specifier || !isLegacyKitImport(specifier)) return;
  context.report({ node, messageId: 'legacyKitImport' });
}

export const noLegacyUiKitRule = {
  meta: {
    type: 'problem',
    messages: {
      legacyKitImport: LEGACY_KIT_MESSAGE,
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowlistPath: { type: 'string' },
          repoRoot: { type: 'string' },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const [options = {}] = context.options ?? [];
    const filename = context.filename ?? context.getFilename?.() ?? '';
    const allowlist = loadAllowlist(options.allowlistPath ?? DEFAULT_ALLOWLIST_PATH);
    if (isAllowlisted(filename, allowlist, options.repoRoot ?? DEFAULT_REPO_ROOT)) {
      return {};
    }

    return {
      ImportDeclaration(node) {
        checkSource(context, node, literalValue(node.source));
      },
      ExportNamedDeclaration(node) {
        checkSource(context, node, literalValue(node.source));
      },
      ExportAllDeclaration(node) {
        checkSource(context, node, literalValue(node.source));
      },
      ImportExpression(node) {
        checkSource(context, node, literalValue(node.source) ?? literalValue(node.arguments?.[0]));
      },
    };
  },
};
