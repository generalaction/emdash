import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const VENDOR_ENTRY = new URL('../../../../renderer/vendor.css', import.meta.url);
const ACTIVE_RENDERER_ENTRY = new URL('../../../../renderer/styles.css', import.meta.url);
const RENDERER_HTML = new URL('../../../../renderer/index.html', import.meta.url);
const ACTIVE_HOST_CSS = new URL('../../../../renderer/index.css', import.meta.url);

describe('desktop vendor CSS entry', () => {
  it('contributes every package stylesheet to emdash.vendor', () => {
    const imports = readFileSync(VENDOR_ENTRY, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('@import'));

    expect(imports).toEqual([
      "@import '@xterm/xterm/css/xterm.css' layer(emdash.vendor);",
      "@import '@fontsource-variable/inter/index.css' layer(emdash.vendor);",
      "@import 'devicon/devicon.min.css' layer(emdash.vendor);",
      "@import 'katex/dist/katex.min.css' layer(emdash.vendor);",
      "@import '@emdash/chat-ui/style.css' layer(emdash.vendor);",
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
    expect(hostCss).toContain("@import 'tw-animate-css';");
  });
});
