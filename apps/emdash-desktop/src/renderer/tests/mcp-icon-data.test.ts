import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { prepareInlineSvgMarkup } from '@renderer/utils/mcp-icon-data';
import { resolveMcpIconKey } from '@renderer/utils/mcpIcons';

const mcpIconsDir = join(fileURLToPath(new URL('.', import.meta.url)), '../../assets/images/mcp');

const CATALOG_ICON_FILES = new Set(
  readdirSync(mcpIconsDir)
    .filter((name) => name.endsWith('.svg') && name !== 'mcp_default.svg')
);

function listCatalogIconFiles(): string[] {
  return [...CATALOG_ICON_FILES].sort();
}

describe('prepareInlineSvgMarkup', () => {
  it('keeps mono icons on currentColor', () => {
    const stripe = readFileSync(join(mcpIconsDir, 'stripe.svg'), 'utf8');
    const processed = prepareInlineSvgMarkup(stripe);

    expect(processed).toContain('fill="currentColor"');
    expect(processed).not.toContain('#1e61f0');
  });

  it('keeps catalog mono icons on currentColor', () => {
    for (const key of ['amplitude', 'honeycomb', 'magic_patterns', 'hugging_face']) {
      const svg = readFileSync(join(mcpIconsDir, `${key}.svg`), 'utf8');
      const processed = prepareInlineSvgMarkup(svg);

      expect(processed).toContain('fill="currentColor"');
      expect(processed).not.toMatch(/fill="#[0-9a-fA-F]{3,8}"/);
    }
  });

  it('keeps the Exa logomark monochrome', () => {
    const exa = readFileSync(join(mcpIconsDir, 'exa.svg'), 'utf8');
    const processed = prepareInlineSvgMarkup(exa);

    expect(processed).toContain('fill="currentColor"');
    expect(exa).toContain('viewBox="0 0 151 182"');
    expect(exa).toContain('M150.5 14.1064');
    expect(processed).not.toContain('#1E40ED');
    expect(processed).not.toContain('fill="white"');
    expect(exa).not.toContain('M128,242.7');
  });

  it('uses the official MCP mark as monochrome fallback markup', () => {
    const fallback = readFileSync(join(mcpIconsDir, 'mcp_default.svg'), 'utf8');
    const processed = prepareInlineSvgMarkup(fallback);

    expect(processed).toContain('stroke="currentColor"');
    expect(processed).not.toContain('fill="black"');
    expect(processed).not.toContain('stroke="white"');
    expect(processed).not.toMatch(/<svg[^>]*fill="currentColor"/);
  });

  it('does not fill stroke-only icons with currentColor', () => {
    const strokeOnly = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M4 12h16" stroke="currentColor" stroke-width="2"/>
</svg>`;
    const processed = prepareInlineSvgMarkup(strokeOnly);

    expect(processed).not.toMatch(/<svg[^>]*fill="currentColor"/);
    expect(processed).toContain('stroke="currentColor"');
  });

  it('matches the official Hugging Face simple-icons mark', () => {
    const local = readFileSync(join(mcpIconsDir, 'hugging_face.svg'), 'utf8');
    expect(local).toContain('<title>Hugging Face</title>');
    expect(local).toContain('M12.025 1.13c-5.77 0-10.449 4.647-10.449 10.378');
  });

  it('uses the official parallel.ai line mark instead of the unrelated cube mark', () => {
    const parallel = readFileSync(join(mcpIconsDir, 'parallel.svg'), 'utf8');
    const processed = prepareInlineSvgMarkup(parallel);

    expect(processed).toContain('fill="currentColor"');
    expect(parallel).toContain('M267.804 105.65');
    expect(parallel).not.toContain('466.73 532.09');
  });
});

describe('resolveMcpIconKey', () => {
  it('maps installed server names to catalog icon keys before falling back', () => {
    expect(resolveMcpIconKey(undefined, 'parallel-search')).toBe('parallel');
    expect(resolveMcpIconKey(undefined, 'Magic Patterns MCP')).toBe('magic_patterns');
    expect(resolveMcpIconKey(undefined, 'Chrome DevTools MCP')).toBe('chrome_devtools');
    expect(resolveMcpIconKey(undefined, 'Shopify Dev')).toBe('shopify');
    expect(resolveMcpIconKey(undefined, 'mcp-server-context7')).toBe('context7');
  });

  it('keeps unknown MCP servers on the official MCP fallback', () => {
    expect(resolveMcpIconKey(undefined, 'mcp-server-time')).toBe('mcp_default');
    expect(resolveMcpIconKey(undefined, 'some private server')).toBeUndefined();
  });
});

describe('mcp catalog icon assets', () => {
  it('matches catalog keys and metadata conventions', () => {
    const iconFiles = listCatalogIconFiles();

    expect(iconFiles.length).toBe(53);

    for (const file of iconFiles) {
      const key = file.replace(/\.svg$/, '');
      const svg = readFileSync(join(mcpIconsDir, file), 'utf8');
      const processed = prepareInlineSvgMarkup(svg);

      expect(svg).toContain('role="img"');
      expect(svg).toContain('<title>');
      expect(processed).toContain('class="h-full w-full"');

      if (key === 'mcp_default') {
        expect(processed).toContain('stroke="currentColor"');
      } else {
        expect(processed).toContain('fill="currentColor"');
      }

      expect(svg).not.toContain('<image');
    }
  });
});
