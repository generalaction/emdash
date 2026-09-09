import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const HOST_ENTRY = new URL('../../../../renderer/index.css', import.meta.url);
const VENDOR_ENTRY = new URL('../../../../renderer/vendor.css', import.meta.url);
const XTERM_ADAPTER = new URL(
  '../../../features/terminals/browser/pty/xterm-theme-adapter.css.ts',
  import.meta.url
);
const MONACO_DIFF_ADAPTER = new URL(
  '../../../features/source-control/browser/styles/monaco-diff-adapter.css.ts',
  import.meta.url
);
const DIFF_FILE_RENDERER = new URL(
  '../../../features/source-control/browser/diff-view/main-panel/diff-file-renderer.tsx',
  import.meta.url
);

describe('desktop integration CSS ownership', () => {
  it('loads animation CSS through the canonical vendor layer', () => {
    const vendorCss = readFileSync(VENDOR_ENTRY, 'utf8');
    const hostCss = readFileSync(HOST_ENTRY, 'utf8');

    expect(vendorCss).toContain("@import 'tw-animate-css';");
    expect(hostCss).not.toContain("@import 'tw-animate-css'");
  });

  it('keeps Xterm and Monaco rules out of the renderer document entry', () => {
    const hostCss = readFileSync(HOST_ENTRY, 'utf8');
    const xtermAdapter = readFileSync(XTERM_ADAPTER, 'utf8');
    const monacoDiffAdapter = readFileSync(MONACO_DIFF_ADAPTER, 'utf8');
    const diffFileRenderer = readFileSync(DIFF_FILE_RENDERER, 'utf8');

    expect(hostCss).not.toMatch(/\.(?:xterm|monaco-editor)\b/);
    expect(hostCss).not.toContain('.file-diff-view');
    expect(hostCss).not.toContain('!important');
    expect(xtermAdapter).toContain("'& .xterm .xterm-viewport'");
    expect(xtermAdapter).not.toContain('!important');
    expect(monacoDiffAdapter).toContain("'& .monaco-editor .margin'");
    expect(monacoDiffAdapter).toContain("'& .monaco-editor .view-zones'");
    expect(monacoDiffAdapter).not.toContain('!important');
    expect(diffFileRenderer).toContain('monacoDiffAdapterClassName');
  });
});
