import { DropdownMenu, MicroLabel } from '@emdash/ui/react/primitives';
import {
  ChevronDown,
  Clipboard,
  ExternalLink,
  Globe,
  Loader2,
  RefreshCcw,
  Square,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  usePreviewServers,
  useTaskComposition,
} from '@core/features/workbench/api/browser/task-composition-context';
import {
  copyTextToClipboard,
  openExternal,
} from '@core/primitives/desktop-host/browser/host-client';
import type { PreviewServer } from '@core/primitives/preview-servers/api';
import { previewServerUrl } from '@core/primitives/preview-servers/api';
import { cn } from '@core/primitives/styling/browser/cn';
import {
  formatPreviewServerLabel,
  previewServerStatusClasses,
  previewServerStatusLabel,
} from './preview-server-format';

export const PreviewServerPill = observer(function PreviewServerPill({
  server,
}: {
  server: PreviewServer;
}) {
  const previews = usePreviewServers();
  const taskView = useTaskComposition();
  const url = previewServerUrl(server);
  const hasUrl = url !== null;
  const canOpen = server.status.kind === 'ready' && hasUrl;
  const title = hasUrl
    ? `${previewServerStatusLabel(server)} at ${url}`
    : `${previewServerStatusLabel(server)} for ${formatPreviewServerLabel(server)}`;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        render={
          <button
            type="button"
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs transition-colors',
              previewServerStatusClasses(server)
            )}
            aria-label={`Open preview ${formatPreviewServerLabel(server)}`}
            title={title}
          />
        }
      >
        {server.status.kind === 'starting' || server.status.kind === 'reconnecting' ? (
          <Loader2 className="size-3 shrink-0 animate-spin" />
        ) : (
          <Globe className="size-3 shrink-0" />
        )}
        <span>{formatPreviewServerLabel(server)}</span>
        <ChevronDown className="size-3 shrink-0" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" className="min-w-56">
        <div className="px-2 py-1.5">
          <MicroLabel className="mb-1 flex items-center">Preview</MicroLabel>
          <div className="truncate text-xs text-foreground-muted" title={url ?? undefined}>
            {url ?? 'No local URL'}
          </div>
          {server.kind === 'forwarded' ? (
            <div className="mt-1 text-xs text-foreground-passive">
              {server.localPort === undefined
                ? `Remote ${server.remotePort}`
                : `Remote ${server.remotePort} to local ${server.localPort}`}
            </div>
          ) : null}
          {server.status.kind === 'failed' ? (
            <div className="mt-1 text-xs text-foreground-destructive">{server.status.message}</div>
          ) : null}
        </div>
        <DropdownMenu.Separator />
        <DropdownMenu.Item
          disabled={!canOpen}
          onClick={() => {
            if (canOpen && url) {
              taskView.paneLayout.open('browser', { initialUrl: url });
              taskView.setFocusedRegion('main');
            }
          }}
        >
          <Globe className="size-3.5" />
          Open in Emdash Browser
        </DropdownMenu.Item>
        <DropdownMenu.Item
          disabled={!canOpen}
          onClick={() => canOpen && url && void openExternal(url)}
        >
          <ExternalLink className="size-3.5" />
          Open in System Browser
        </DropdownMenu.Item>
        <DropdownMenu.Item disabled={!hasUrl} onClick={() => url && void copyTextToClipboard(url)}>
          <Clipboard className="size-3.5" />
          Copy URL
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        {server.kind === 'forwarded' ? (
          <DropdownMenu.Item onClick={() => void previews.restart(server.id)}>
            <RefreshCcw className="size-3.5" />
            Restart Forward
          </DropdownMenu.Item>
        ) : null}
        <DropdownMenu.Item variant="destructive" onClick={() => void previews.stop(server.id)}>
          <Square className="size-3.5" />
          Stop
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
});
