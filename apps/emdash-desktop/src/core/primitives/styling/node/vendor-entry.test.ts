import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const VENDOR_ENTRY = new URL('../../../../renderer/vendor.css', import.meta.url);
const ACTIVE_RENDERER_ENTRY = new URL('../../../../renderer/styles.css', import.meta.url);
const RENDERER_HTML = new URL('../../../../renderer/index.html', import.meta.url);
const ACTIVE_HOST_CSS = new URL('../../../../renderer/index.css', import.meta.url);
const UI_BASE_CSS = new URL(
  '../../../../../../../packages/ui/src/styles/base.css',
  import.meta.url
);

describe('desktop vendor CSS entry', () => {
  it('owns package styles and Tailwind directive sources in the canonical vendor entry', () => {
    const imports = readFileSync(VENDOR_ENTRY, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('@import'));

    expect(imports).toEqual([
      "@import '@xterm/xterm/css/xterm.css' layer(emdash.vendor);",
      "@import '@fontsource-variable/inter/index.css' layer(emdash.vendor);",
      "@import 'devicon/devicon.min.css' layer(emdash.vendor);",
      "@import 'katex/dist/katex.min.css' layer(emdash.vendor);",
      "@import '@emdash/chat-ui/style.css' layer(emdash.vendor);",
      "@import 'tw-animate-css';",
    ]);
  });

  it('loads the aggregate once before the vendor and host entries', () => {
    const rendererEntry = readFileSync(ACTIVE_RENDERER_ENTRY, 'utf8');
    const rendererHtml = readFileSync(RENDERER_HTML, 'utf8');
    const hostCss = readFileSync(ACTIVE_HOST_CSS, 'utf8');
    const aggregateImport = "@import '@emdash/ui/styles.css';";
    const vendorImport = "@import './vendor.css';";
    const hostImport = "@import './index.css';";

    expect(rendererEntry.match(/@emdash\/ui\/styles\.css/g)).toHaveLength(1);
    expect(rendererEntry.indexOf(aggregateImport)).toBeLessThan(
      rendererEntry.indexOf(vendorImport)
    );
    expect(rendererEntry.indexOf(vendorImport)).toBeLessThan(rendererEntry.indexOf(hostImport));
    expect(rendererHtml).toContain('<link rel="stylesheet" href="./styles.css" />');
    expect(hostCss).not.toContain('@xterm/xterm/css/xterm.css');
    expect(hostCss).not.toContain("@import 'tw-animate-css'");
  });

  it('leaves shared document colors, borders, selection, and scrollbars to UI base', () => {
    const uiBaseCss = readFileSync(UI_BASE_CSS, 'utf8');
    const hostCss = readFileSync(ACTIVE_HOST_CSS, 'utf8');

    expect(uiBaseCss).toContain('background-color: var(--em-surface);');
    expect(uiBaseCss).toContain('border-color: var(--em-border);');
    expect(uiBaseCss).toContain('scrollbar-width: thin;');
    expect(uiBaseCss).toContain('::-webkit-scrollbar');
    expect(uiBaseCss).toContain('::selection');

    expect(hostCss).not.toContain('@apply bg-background text-foreground');
    expect(hostCss).not.toContain('@apply border-border');
    expect(hostCss).not.toContain('scrollbar-width: thin;');
    expect(hostCss).not.toMatch(/^\s*\*::-webkit-scrollbar/m);
    expect(hostCss).not.toContain('::selection');
  });
});
