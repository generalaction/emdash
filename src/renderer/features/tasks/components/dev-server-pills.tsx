import { ExternalLink, Globe } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { rpc } from '@renderer/lib/ipc';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { useDevServers } from '../task-view-context';

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

  if (urls.length === 0) return null;

  return (
    <>
      {urls.map((url) => (
        <Tooltip key={url}>
          <TooltipTrigger>
            <button
              type="button"
              onClick={() => rpc.app.openExternal(url)}
              className="flex h-7 items-center gap-1.5 rounded-lg bg-background-info px-2 text-xs text-foreground-muted transition-colors hover:border-border-info hover:bg-background-info-hover hover:text-foreground"
            >
              <Globe className="size-3 shrink-0 text-foreground-info" />
              <span className="text-foreground-info">{formatUrl(url)}</span>
              <ExternalLink className="size-3 shrink-0 text-foreground-info" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Dev server running at {url}
          </TooltipContent>
        </Tooltip>
      ))}
    </>
  );
});
