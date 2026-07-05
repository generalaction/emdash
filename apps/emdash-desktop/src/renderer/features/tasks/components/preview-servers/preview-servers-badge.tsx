import { ChevronDown, Globe, Loader2, Square } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { usePreviewServers } from '@renderer/features/tasks/task-view-context';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { MicroLabel } from '@renderer/lib/ui/label';
import { cn } from '@renderer/utils/utils';
import type { PreviewServer } from '@shared/core/preview-servers/types';
import {
  formatPreviewServerLabel,
  previewServersSummaryStatusKind,
  previewServerStatusKindClasses,
} from './preview-server-format';
import { PreviewServerMenuItems } from './preview-server-menu-items';

export const PreviewServersBadge = observer(function PreviewServersBadge({
  servers,
}: {
  servers: PreviewServer[];
}) {
  const previews = usePreviewServers();
  const showConfirm = useShowModal('confirmActionModal');
  const { toast } = useToast();
  const summaryKind = previewServersSummaryStatusKind(servers);
  const isBusy = summaryKind === 'starting' || summaryKind === 'reconnecting';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs transition-colors',
              previewServerStatusKindClasses(summaryKind)
            )}
            aria-label={`${servers.length} preview servers`}
            title={`${servers.length} preview servers running`}
          />
        }
      >
        {isBusy ? (
          <Loader2 className="size-3 shrink-0 animate-spin" />
        ) : (
          <Globe className="size-3 shrink-0" />
        )}
        <span>{servers.length} servers</span>
        <ChevronDown className="size-3 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <div className="px-2 py-1.5">
          <MicroLabel className="flex items-center">Preview Servers</MicroLabel>
        </div>
        <DropdownMenuSeparator />
        {servers.map((server) => (
          <DropdownMenuSub key={server.id}>
            <DropdownMenuSubTrigger>
              {server.status.kind === 'starting' || server.status.kind === 'reconnecting' ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Globe
                  className={cn(
                    'size-3.5',
                    server.status.kind === 'failed' && 'text-foreground-destructive'
                  )}
                />
              )}
              <span className="truncate">{formatPreviewServerLabel(server)}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-56">
              <PreviewServerMenuItems server={server} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => {
            const count = servers.length;
            showConfirm({
              title: 'Stop workspace preview servers?',
              description: `This will stop ${count === 1 ? 'the running preview server' : `all ${count} running preview servers`} in this workspace.`,
              confirmLabel: 'Stop All',
              variant: 'destructive',
              onSuccess: () => {
                void previews.stopAll().catch((error: unknown) => {
                  toast({
                    title: 'Failed to stop preview servers',
                    description: String(error),
                    variant: 'destructive',
                  });
                });
              },
            });
          }}
        >
          <Square className="size-3.5" />
          Stop All Servers
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
