#!/usr/bin/env node
/**
 * generate-icons.ts
 *
 * Reads icon assets from apps/emdash-desktop/src/assets/images/ and emits
 * impl/<id>/icon.tsx for every agent provider.
 *
 * Run with: npx tsx scripts/generate-icons.ts
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Provider icon metadata ──────────────────────────────────────────────────

type ProviderIconSpec = {
  id: string;
  icon: string;
  iconDark?: string;
  invertInDark?: boolean;
  alt?: string;
};

const PROVIDERS: ProviderIconSpec[] = [
  { id: 'codex', icon: 'openai.svg', alt: 'Codex' },
  { id: 'claude', icon: 'claude.svg', alt: 'Claude Code' },
  { id: 'grok', icon: 'xai.svg', alt: 'Grok CLI', invertInDark: true },
  { id: 'devin', icon: 'devin.png', alt: 'Devin' },
  { id: 'cursor', icon: 'cursor.svg', alt: 'Cursor CLI', invertInDark: true },
  { id: 'gemini', icon: 'gemini.svg', alt: 'Gemini CLI' },
  { id: 'antigravity', icon: 'antigravity.svg', alt: 'Antigravity CLI' },
  { id: 'qwen', icon: 'qwen.svg', alt: 'Qwen Code CLI' },
  { id: 'droid', icon: 'droid.svg', alt: 'Factory Droid' },
  { id: 'amp', icon: 'ampcode.svg', alt: 'Amp CLI' },
  { id: 'commandcode', icon: 'commandcode.svg', alt: 'Command Code CLI' },
  { id: 'opencode', icon: 'opencode.svg', iconDark: 'opencode-dark.svg', alt: 'OpenCode CLI' },
  { id: 'hermes', icon: 'hermesagent.jpg', alt: 'Hermes Agent CLI' },
  { id: 'copilot', icon: 'gh-copilot.svg', alt: 'GitHub Copilot CLI', invertInDark: true },
  { id: 'charm', icon: 'charm.png', alt: 'Charm CLI' },
  { id: 'auggie', icon: 'Auggie.svg', alt: 'Auggie CLI', invertInDark: true },
  { id: 'goose', icon: 'goose.png', alt: 'Goose CLI' },
  { id: 'kimi', icon: 'kimi.svg', alt: 'Kimi CLI' },
  { id: 'kilocode', icon: 'kilocode.png', alt: 'Kilocode CLI' },
  { id: 'kiro', icon: 'kiro.png', alt: 'Kiro CLI' },
  { id: 'rovo', icon: 'atlassian.png', alt: 'Rovo Dev CLI' },
  { id: 'cline', icon: 'cline.png', alt: 'Cline CLI' },
  { id: 'continue', icon: 'continue.png', alt: 'Continue CLI' },
  { id: 'codebuff', icon: 'codebuff.png', alt: 'Codebuff CLI' },
  { id: 'freebuff', icon: 'codebuff.png', alt: 'Freebuff CLI' },
  { id: 'mistral', icon: 'mistral.svg', alt: 'Mistral Vibe CLI' },
  { id: 'jules', icon: 'jules.svg', alt: 'Jules CLI' },
  { id: 'junie', icon: 'junie-color.png', alt: 'Junie CLI' },
  { id: 'pi', icon: 'pi.png', alt: 'Pi CLI' },
  { id: 'letta', icon: 'letta.svg', alt: 'Letta Code CLI', invertInDark: true },
  { id: 'autohand', icon: 'autohand.svg', alt: 'Autohand Code CLI' },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

const ASSETS_DIR = resolve(
  __dirname,
  '../../../apps/emdash-desktop/src/assets/images'
);
const IMPL_DIR = resolve(__dirname, '../impl');

function readAsset(filename: string): { content: string; isSvg: boolean } {
  const filePath = join(ASSETS_DIR, filename);
  if (!existsSync(filePath)) {
    throw new Error(`Asset not found: ${filePath}`);
  }
  const ext = extname(filename).toLowerCase();
  const isSvg = ext === '.svg';
  if (isSvg) {
    return { content: readFileSync(filePath, 'utf8'), isSvg: true };
  }
  // Binary: base64 data URI
  const buf = readFileSync(filePath);
  const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'application/octet-stream';
  return { content: `data:${mime};base64,${buf.toString('base64')}`, isSvg: false };
}

function escapeTick(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

function generateIconFile(spec: ProviderIconSpec): string {
  const light = readAsset(spec.icon);

  let darkSection = '';
  if (spec.iconDark) {
    const dark = readAsset(spec.iconDark);
    if (dark.isSvg) {
      darkSection = `,\n  dark: \`${escapeTick(dark.content)}\``;
    } else {
      darkSection = `,\n  dark: '${dark.content}'`;
    }
  }

  const invertSection = spec.invertInDark ? ',\n  invertInDark: true' : '';
  const factory = light.isSvg ? 'inlineSvgIcon' : 'imageIcon';
  const altSection = spec.alt ? `,\n  alt: '${spec.alt.replace(/'/g, "\\'")}'` : '';

  let lightValue: string;
  if (light.isSvg) {
    lightValue = `\`${escapeTick(light.content)}\``;
  } else {
    lightValue = `'${light.content}'`;
  }

  return `import { ${factory} } from '../../helpers/icon';

const Icon = ${factory}({
  light: ${lightValue}${darkSection}${invertSection}${altSection},
});

export default Icon;
`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

let generated = 0;
let skipped = 0;

for (const spec of PROVIDERS) {
  const dir = join(IMPL_DIR, spec.id);
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, 'icon.tsx');
  try {
    const content = generateIconFile(spec);
    writeFileSync(outPath, content, 'utf8');
    console.log(`✓ ${spec.id}/icon.tsx`);
    generated++;
  } catch (err) {
    console.warn(`⚠ ${spec.id}: ${(err as Error).message} — skipping`);
    skipped++;
  }
}

console.log(`\nDone: ${generated} generated, ${skipped} skipped`);
