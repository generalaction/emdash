import type { PluginIconAsset } from '@emdash/shared/plugins';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@core/primitives/theme/browser', () => ({
  useTheme: () => ({ effectiveTheme: 'emlight' }),
}));

import { PluginIcon } from './plugin-icon';

describe('PluginIcon', () => {
  it('roots foreign SVG markup in the plugin asset adapter', () => {
    const icon: PluginIconAsset = {
      kind: 'svg',
      alt: 'Fixture',
      variants: [{ minSize: 0, light: '<svg viewBox="0 0 16 16"><path d="M0 0h1v1z"/></svg>' }],
    };

    const html = renderToStaticMarkup(createElement(PluginIcon, { id: 'fixture', icon, size: 20 }));

    expect(html).toContain('data-foreign-adapter="plugin-asset"');
    expect(html).toContain('--_plugin-icon-size:20px');
    expect(html).not.toContain('--em-');
    expect(html).toMatch(/<span[^>]*><svg/);
  });
});
