import { readFile, readdir } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { parse, type AnyNode } from 'acorn';

const nativePackages = ['@parcel/watcher', 'better-sqlite3', 'node-pty'] as const;

export async function inspectBundles(
  distDirectory: string,
  expectedEntryBundleNames: readonly string[]
): Promise<string[]> {
  const entries = await readdir(distDirectory, { withFileTypes: true });
  const bundleNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
    .map((entry) => entry.name)
    .sort();

  const missingEntryBundles = expectedEntryBundleNames.filter(
    (bundleName) => !bundleNames.includes(bundleName)
  );
  if (missingEntryBundles.length > 0) {
    throw new Error(
      `Workspace-server build is missing entry bundles: ${missingEntryBundles.join(', ')}`
    );
  }

  const bundleNameSet = new Set(bundleNames);
  const errors: string[] = [];
  for (const bundleName of bundleNames) {
    const source = await readFile(join(distDirectory, bundleName), 'utf8');
    let program: AnyNode;
    try {
      program = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    } catch (error) {
      errors.push(`${bundleName} could not be parsed: ${String(error)}`);
      continue;
    }
    const { specifiers, issues } = inspectModuleLoads(program);
    errors.push(...[...issues].map((issue) => `${bundleName} ${issue}`));
    for (const specifier of specifiers) {
      if (specifier.startsWith('.')) {
        const importedBundlePath = resolve(distDirectory, dirname(bundleName), specifier);
        const importedBundleName = relative(distDirectory, importedBundlePath);
        if (importedBundleName.startsWith('../') || !bundleNameSet.has(importedBundleName)) {
          errors.push(`${bundleName} imports missing bundle '${specifier}'`);
        }
        continue;
      }
      if (!isAllowedBundleExternal(specifier)) {
        errors.push(`${bundleName} contains unexpected external '${specifier}'`);
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(`Workspace-server bundles are not self-contained:\n${errors.join('\n')}`);
  }

  return bundleNames;
}

function inspectModuleLoads(program: AnyNode): { specifiers: Set<string>; issues: Set<string> } {
  const specifiers = new Set<string>();
  const issues = new Set<string>();
  for (const node of walkNodes(program)) {
    if (staticString(node)?.endsWith('.node')) {
      issues.add('contains a native .node binding reference');
    }

    switch (node.type) {
      case 'ImportDeclaration':
      case 'ExportNamedDeclaration':
      case 'ExportAllDeclaration': {
        const specifier = staticString(node.source);
        if (specifier !== undefined) specifiers.add(specifier);
        break;
      }
      case 'ImportExpression': {
        const specifier = staticString(node.source);
        if (specifier !== undefined) specifiers.add(specifier);
        else issues.add('contains a dynamic import call');
        break;
      }
      case 'CallExpression': {
        if (!isRequire(node.callee)) break;
        const specifier = staticString(node.arguments[0]);
        if (specifier !== undefined) specifiers.add(specifier);
        else issues.add('contains a dynamic require call');
        break;
      }
    }
  }
  return { specifiers, issues };
}

function staticString(node: AnyNode | null | undefined): string | undefined {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}

function isRequire(node: AnyNode): boolean {
  if (node.type === 'Identifier') return node.name === 'require' || node.name === '__require';
  return (
    node.type === 'MemberExpression' &&
    node.object.type === 'Identifier' &&
    node.object.name === 'module' &&
    (node.computed
      ? staticString(node.property) === 'require'
      : node.property.type === 'Identifier' && node.property.name === 'require')
  );
}

function* walkNodes(root: AnyNode): Generator<AnyNode> {
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    yield node;
    const values: unknown[] = Object.values(node);
    for (const value of values) {
      const children: unknown[] = Array.isArray(value) ? value : [value];
      for (const child of children) {
        if (isNode(child)) pending.push(child);
      }
    }
  }
}

function isNode(value: unknown): value is AnyNode {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    typeof value.type === 'string' &&
    'start' in value &&
    typeof value.start === 'number'
  );
}

function isAllowedBundleExternal(specifier: string): boolean {
  if (specifier.startsWith('node:') || builtinModules.includes(specifier)) return true;
  return nativePackages.some(
    (packageName) => specifier === packageName || specifier.startsWith(`${packageName}/`)
  );
}
