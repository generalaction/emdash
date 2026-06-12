#!/usr/bin/env node
/**
 * Migrate icon.tsx → icon.ts for all 31 impl plugins.
 * Extracts SVG/image data and produces a typed iconAsset export.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const IMPL_DIR = new URL('../src/agents/impl', import.meta.url).pathname;

const IMPLS = [
  'amp',
  'antigravity',
  'auggie',
  'autohand',
  'charm',
  'claude',
  'cline',
  'codebuff',
  'codex',
  'commandcode',
  'continue',
  'copilot',
  'cursor',
  'devin',
  'droid',
  'freebuff',
  'gemini',
  'goose',
  'grok',
  'hermes',
  'jules',
  'junie',
  'kilocode',
  'kimi',
  'kiro',
  'letta',
  'mistral',
  'opencode',
  'pi',
  'qwen',
  'rovo',
];

function extractBacktickString(src, start) {
  // find matching backtick, handling nested template expressions
  let i = start;
  let result = '';
  let depth = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '`' && depth === 0) return { value: result, end: i + 1 };
    if (ch === '$' && src[i + 1] === '{') {
      depth++;
      i += 2;
      result += '${';
      continue;
    }
    if (ch === '}' && depth > 0) {
      depth--;
      result += '}';
      i++;
      continue;
    }
    if (ch === '\\') {
      result += src[i + 1];
      i += 2;
      continue;
    }
    result += ch;
    i++;
  }
  throw new Error('Unterminated backtick string at ' + start);
}

function extractStringArg(src, after) {
  // after a key like `light: ` find the value string (backtick or single/double quote)
  let i = after;
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] === '`') {
    return extractBacktickString(src, i + 1);
  }
  if (src[i] === '"' || src[i] === "'") {
    const q = src[i];
    let result = '';
    i++;
    while (i < src.length) {
      if (src[i] === q) return { value: result, end: i + 1 };
      if (src[i] === '\\') {
        result += src[i + 1];
        i += 2;
        continue;
      }
      result += src[i];
      i++;
    }
  }
  throw new Error('Cannot find string at pos ' + after + ': ' + src.slice(after, after + 40));
}

function parseIconCall(src) {
  // Determine kind
  const isImage = /imageIcon\s*\(/.test(src);
  const kind = isImage ? 'image' : 'svg';

  // Extract opts object content
  const callMatch = src.match(isImage ? /imageIcon\s*\(\s*\{/ : /inlineSvgIcon\s*\(\s*\{/);
  if (!callMatch) throw new Error('Cannot find icon call');
  const optsStart = src.indexOf('{', callMatch.index + callMatch[0].length - 1) + 1;

  // Find light:
  const lightIdx = src.indexOf('light:', optsStart);
  const lightColon = src.indexOf(':', lightIdx) + 1;
  const { value: light } = extractStringArg(src, lightColon);

  // Find dark: (optional)
  let dark = undefined;
  const darkIdx = src.indexOf('dark:', optsStart);
  // Make sure it's not 'invertInDark:'
  if (darkIdx !== -1 && src.slice(darkIdx, darkIdx + 15).startsWith('dark:')) {
    const darkColon = src.indexOf(':', darkIdx) + 1;
    const res = extractStringArg(src, darkColon);
    dark = res.value;
  }

  // Find invertInDark: (optional)
  const invertIdx = src.indexOf('invertInDark:', optsStart);
  let invertInDark = undefined;
  if (invertIdx !== -1) {
    const valStr = src.slice(invertIdx + 'invertInDark:'.length).trim();
    invertInDark = valStr.startsWith('true');
  }

  // Find alt: (optional)
  const altIdx = src.indexOf('alt:', optsStart);
  let alt = undefined;
  if (altIdx !== -1) {
    const altColon = src.indexOf(':', altIdx) + 1;
    try {
      const res = extractStringArg(src, altColon);
      alt = res.value;
    } catch {
      /* skip */
    }
  }

  return { kind, light, dark, invertInDark, alt };
}

function escapeTemplate(s) {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

function generateIconTs(name, opts) {
  const { kind, light, dark, invertInDark, alt } = opts;

  const variantLines = [
    `  { minSize: 0, light: \`${escapeTemplate(light)}\`` +
      (dark ? `, dark: \`${escapeTemplate(dark)}\`` : '') +
      ` }`,
  ];

  return `import type { AgentIconAsset } from '@emdash/shared/agents/plugins';

export const icon: AgentIconAsset = {
  kind: '${kind}',${alt ? `\n  alt: '${alt.replace(/'/g, "\\'")}',` : ''}${invertInDark ? '\n  invertInDark: true,' : ''}
  variants: [
${variantLines.join(',\n')}
  ],
};
`;
}

let errors = 0;
for (const impl of IMPLS) {
  const tsxPath = join(IMPL_DIR, impl, 'icon.tsx');
  const tsPath = join(IMPL_DIR, impl, 'icon.ts');
  try {
    const src = readFileSync(tsxPath, 'utf8');
    const opts = parseIconCall(src);
    const output = generateIconTs(impl, opts);
    writeFileSync(tsPath, output);
    console.log(`✓ ${impl}`);
  } catch (e) {
    console.error(`✗ ${impl}: ${e.message}`);
    errors++;
  }
}
if (errors > 0) {
  console.error(`\n${errors} errors`);
  process.exit(1);
} else {
  console.log('\nAll icons migrated!');
}
