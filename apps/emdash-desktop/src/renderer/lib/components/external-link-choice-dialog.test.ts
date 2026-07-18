import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from '@renderer/lib/ui/dialog';
import { ExternalLinkChoiceDialog } from './external-link-choice-dialog';

describe('ExternalLinkChoiceDialog', () => {
  it('offers a copy action inside the displayed external link', () => {
    const html = renderToStaticMarkup(
      createElement(
        Dialog,
        { open: true },
        createElement(ExternalLinkChoiceDialog, {
          url: 'https://example.com/docs',
          canOpenInEmdashBrowser: true,
          onCopy: vi.fn(() => true),
          onSuccess: vi.fn(),
          onClose: vi.fn(),
        })
      )
    );

    expect(html).toContain('https://example.com/docs');
    expect(html).toContain('aria-label="Copy link"');
  });
});
