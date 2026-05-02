import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DeprecationBanner } from './deprecation-banner';

describe('DeprecationBanner', () => {
  it('renders a compact sidebar notice with deprecated copy and stable download action', () => {
    const html = renderToStaticMarkup(
      createElement(DeprecationBanner, {
        onDownloadStable: vi.fn(),
        downloadUrl: 'https://www.emdash.sh/download',
      })
    );

    expect(html).toContain('v1-beta deprecated');
    expect(html).toContain('Download stable');
    expect(html).toContain('aria-label="Download the new stable version of Emdash"');
    expect(html).toContain('rounded-xl');
    expect(html).not.toContain('Download the new stable version to stay on the supported release.');
  });

  it('renders a full-width settings notice when used in settings', () => {
    const html = renderToStaticMarkup(
      createElement(DeprecationBanner, {
        onDownloadStable: vi.fn(),
        downloadUrl: 'https://www.emdash.sh/download',
        placement: 'settings',
      })
    );

    expect(html).toContain('w-full');
    expect(html).toContain('p-4');
    expect(html).toContain('v1-beta deprecated');
    expect(html).toContain('Download stable');
  });
});
