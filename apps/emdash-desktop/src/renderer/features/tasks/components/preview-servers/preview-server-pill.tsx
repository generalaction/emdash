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
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { MicroLabel } from '@renderer/lib/ui/label';
import { cn } from '@renderer/utils/utils';
import type { PreviewServer } from '@shared/core/preview-servers/types';
import { previewServerUrl } from '@shared/core/preview-servers/types';
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
  const taskView = useWorkspaceViewModel();
  const url = previewServerUrl(server);
  const canOpen = server.status.kind === 'ready';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs transition-colors',
              previewServerStatusClasses(server)
            )}
            aria-label={`Open preview ${formatPreviewServerLabel(server)}`}
            title={`${previewServerStatusLabel(server)} at ${url}`}
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
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <div className="px-2 py-1.5">
          <MicroLabel className="mb-1 flex items-center">Preview</MicroLabel>
          <div className="truncate text-xs text-foreground-muted" title={url}>
            {url}
          </div>
          {server.kind === 'forwarded' ? (
            <div className="mt-1 text-xs text-foreground-passive">
              Remote {server.remotePort} to local {server.localPort}
            </div>
          ) : null}
          {server.status.kind === 'failed' ? (
            <div className="mt-1 text-xs text-foreground-destructive">{server.status.message}</div>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!canOpen}
          onClick={() => {
            if (canOpen) taskView.tabGroupManager.openBrowser(url);
            taskView.setFocusedRegion('main');
          }}
        >
          <Globe className="size-3.5" />
          Open in Emdash Browser
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canOpen}
          onClick={() => canOpen && void rpc.app.openExternal(url)}
        >
          <ExternalLink className="size-3.5" />
          Open in System Browser
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void rpc.app.clipboardWriteText(url)}>
          <Clipboard className="size-3.5" />
          Copy URL
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {server.kind === 'forwarded' ? (
          <DropdownMenuItem onClick={() => void previews.restart(server.id)}>
            <RefreshCcw className="size-3.5" />
            Restart Forward
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem variant="destructive" onClick={() => void previews.stop(server.id)}>
          <Square className="size-3.5" />
          Stop
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
