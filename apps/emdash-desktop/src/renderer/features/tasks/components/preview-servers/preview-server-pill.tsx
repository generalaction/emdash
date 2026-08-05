import { ChevronDown, Globe, Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';
import type { PreviewServer } from '@shared/core/preview-servers/types';
import { previewServerUrl } from '@shared/core/preview-servers/types';
import {
  formatPreviewServerLabel,
  previewServerStatusClasses,
  previewServerStatusLabel,
} from './preview-server-format';
import { PreviewServerMenuItems } from './preview-server-menu-items';

export const PreviewServerPill = observer(function PreviewServerPill({
  server,
}: {
  server: PreviewServer;
}) {
  const url = previewServerUrl(server);
  const title =
    url !== null
      ? `${previewServerStatusLabel(server)} at ${url}`
      : `${previewServerStatusLabel(server)} for ${formatPreviewServerLabel(server)}`;

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
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <PreviewServerMenuItems server={server} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
