import { ExternalLink, Globe } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip';
import { rpc } from '@renderer/core/ipc';
import { useProvisionedTask } from '../task-view-context';

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
  const urls = useProvisionedTask().devServers.urls;

  if (urls.length === 0) return null;

  return (
    <>
      {urls.map((url) => (
        <Tooltip key={url}>
          <TooltipTrigger>
            <button
              type="button"
              onClick={() => rpc.app.openExternal(url)}
              className="flex h-7 rounded-md items-center gap-1.5 border border-green-300 bg-green-50 px-2 py-1 text-xs text-foreground-muted transition-colors hover:border-green-400 hover:text-foreground"
            >
              <Globe className="size-3 shrink-0 text-green-700" />
              <span className="text-green-700">{formatUrl(url)}</span>
              <ExternalLink className="size-3 shrink-0 text-green-700" />
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
