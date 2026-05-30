import { createElement } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { showModal } from '@renderer/lib/modal/modal-provider';

export function confirmOpenExternalLink(url: string, onError?: (error: unknown) => void): void {
  showModal('confirmExternalLinkModal', {
    title: 'Open link in browser?',
    description: createElement(
      'div',
      { className: 'space-y-4 text-sm leading-relaxed' },
      createElement('p', null, 'This link opens outside Emdash in your default browser.'),
      createElement(
        'div',
        {
          className:
            'max-h-32 overflow-y-auto rounded-md border border-border bg-muted/50 px-3 py-2.5 font-mono text-[13px] leading-relaxed break-all text-foreground',
        },
        url
      )
    ),
    confirmLabel: 'Open',
    variant: 'default',
    onSuccess: () => {
      rpc.app.openExternal(url).catch((error) => {
        onError?.(error);
      });
    },
  });
}
