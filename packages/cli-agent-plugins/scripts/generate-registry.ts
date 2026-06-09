#!/usr/bin/env node
/**
 * generate-registry.ts
 *
 * Regenerates the three root registry barrel files (metadata.ts, icons.ts,
 * providers.ts) from the current list of impl/<id>/index.ts entries.
 *
 * Run with: npx tsx scripts/generate-registry.ts
 */

import { readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

// Discover all impl/<id> directories
const implDir = join(ROOT, 'impl');
const ids = readdirSync(implDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

// Safe alias for a plugin id (e.g. 'continue' → 'continueCli')
function alias(id: string): string {
  const reserved = new Set([
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
    'default', 'delete', 'do', 'else', 'export', 'extends', 'finally',
    'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new',
    'return', 'static', 'super', 'switch', 'this', 'throw', 'try', 'typeof',
    'var', 'void', 'while', 'with', 'yield',
  ]);
  if (reserved.has(id)) return `${id}Plugin`;
  return id.includes('-') ? id.replaceAll('-', '_') : id;
}

// ── metadata.ts ──────────────────────────────────────────────────────────────

const metadataImports = ids
  .map((id) => `import { metadata as ${alias(id)} } from './impl/${id}';`)
  .join('\n');

const metadataList = ids.map((id) => `  ${alias(id)},`).join('\n');

const metadataContent = `\
// Renderer-safe: imports only declarative metadata — no Node.js deps, no functions.
import { CLIAgentPluginMetadataRegistry } from './core';

${metadataImports}

export const metadataRegistry = new CLIAgentPluginMetadataRegistry();

for (const m of [
${metadataList}
]) {
  metadataRegistry.register(m);
}
`;

// ── icons.ts ─────────────────────────────────────────────────────────────────

const iconImports = ids
  .map(
    (id) =>
      `import { Icon as ${alias(id).charAt(0).toUpperCase() + alias(id).slice(1)}Icon } from './impl/${id}';`
  )
  .join('\n');

const iconEntries = ids
  .map((id) => {
    const a = alias(id);
    const capitalized = a.charAt(0).toUpperCase() + a.slice(1);
    return `  ['${id}', ${capitalized}Icon],`;
  })
  .join('\n');

const iconsContent = `\
// Renderer-safe: imports only React icon components — no Node.js deps, no functions.
import { CLIAgentPluginIconRegistry } from './core';

${iconImports}

export const iconRegistry = new CLIAgentPluginIconRegistry();

const entries: [string, React.ComponentType<{ size?: number; mode?: 'light' | 'dark' }>][] = [
${iconEntries}
];

for (const [id, icon] of entries) {
  iconRegistry.register(id, icon);
}
`;

// ── providers.ts ─────────────────────────────────────────────────────────────

const providerImports = ids
  .map((id) => `import { provider as ${alias(id)} } from './impl/${id}';`)
  .join('\n');

const providerList = ids.map((id) => `  ${alias(id)},`).join('\n');

const providersContent = `\
// Main process only: imports full provider implementations (buildCommand, hooks, mcp, plugin).
import { CLIAgentPluginProviderRegistry } from './core';

${providerImports}

export const providerRegistry = new CLIAgentPluginProviderRegistry();

for (const p of [
${providerList}
]) {
  providerRegistry.register(p);
}
`;

writeFileSync(join(ROOT, 'metadata.ts'), metadataContent);
writeFileSync(join(ROOT, 'icons.ts'), iconsContent);
writeFileSync(join(ROOT, 'providers.ts'), providersContent);

console.log(`Generated registry barrels for ${ids.length} plugins: ${ids.join(', ')}`);
