import { rpc } from '@renderer/lib/ipc';
import { showModal } from '@renderer/lib/modal/modal-provider';
import { normalizeExternalHttpUrl } from './external-url';

const HTTP_URL_PATTERN = /^https?:\/\//i;

export function confirmOpenExternalLink(url: string, onError?: (error: unknown) => void): void {
  const normalizedUrl = normalizeExternalHttpUrl(url);

  if (!HTTP_URL_PATTERN.test(normalizedUrl)) {
    return;
  }

  showModal('confirmExternalLinkModal', {
    title: 'Open link in browser?',
    description: (
      <div className="space-y-4 text-sm leading-relaxed">
        <p>This link opens outside Emdash in your default browser.</p>
        <div className="bg-muted/50 max-h-32 overflow-y-auto rounded-md border border-border px-3 py-2.5 font-mono text-[13px] leading-relaxed break-all text-foreground">
          {normalizedUrl}
        </div>
      </div>
    ),
    confirmLabel: 'Open',
    variant: 'default',
    onSuccess: () => {
      rpc.app.openExternal(normalizedUrl).catch((error) => {
        onError?.(error);
      });
    },
  });
}
