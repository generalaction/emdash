import { ChevronDown, Globe } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { rpc } from '@renderer/lib/ipc';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { useDevServers, useWorkspaceViewModel } from '../task-view-context';

function formatUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return url;
  }
}

export const DevServerPills = observer(function DevServerPills({
  projectId: _projectId,
  taskId: _taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const urls = useDevServers().urls;
  const taskView = useWorkspaceViewModel();

  if (urls.length === 0) return null;

  return (
    <>
      {urls.map((url) => (
        <DropdownMenu key={url}>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="flex h-7 items-center gap-1.5 rounded-lg bg-background-info px-2 text-xs text-foreground-muted transition-colors hover:border-border-info hover:bg-background-info-hover hover:text-foreground"
                aria-label={`Open dev server ${formatUrl(url)}`}
                title={`Dev server running at ${url}`}
              />
            }
          >
            <Globe className="size-3 shrink-0 text-foreground-info" />
            <span className="text-foreground-info">{formatUrl(url)}</span>
            <ChevronDown className="size-3 shrink-0 text-foreground-info" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuItem onClick={() => void rpc.app.openExternal(url)}>
              Open in System Browser
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                taskView.tabGroupManager.openBrowser(url);
                taskView.setFocusedRegion('main');
              }}
            >
              Open in Emdash Browser
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ))}
    </>
  );
});
