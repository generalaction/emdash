import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';

vi.mock('@renderer/lib/hooks/useTheme', () => ({
  useTheme: () => ({ effectiveTheme: 'emlight' }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    app: {
      openExternal: vi.fn(),
    },
  },
}));

describe('MarkdownRenderer', () => {
  it('constrains markdown images in compact rendering', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownRenderer, {
        content: '![Screenshot](https://example.com/screenshot.png)',
        variant: 'compact',
      })
    );

    expect(html).toContain('src="https://example.com/screenshot.png"');
    expect(html).toContain('alt="Screenshot"');
    expect(html).toContain('max-w-full');
    expect(html).toContain('max-h-80');
    expect(html).toContain('object-contain');
  });

  it('constrains allowed HTML images in compact rendering', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownRenderer, {
        allowHtml: true,
        content: '<img src="https://example.com/preview.png" alt="Preview">',
        variant: 'compact',
      })
    );

    expect(html).toContain('src="https://example.com/preview.png"');
    expect(html).toContain('alt="Preview"');
    expect(html).toContain('max-w-full');
    expect(html).toContain('max-h-80');
    expect(html).toContain('object-contain');
  });
});
