import type { GitRemote } from '@emdash/shared/git';
import { SelectContent, SelectItem } from '@renderer/lib/ui/select';

type RemoteSelectContentProps = {
  remotes: GitRemote[];
  fallbackRemoteName?: string;
};

export function RemoteSelectContent({
  remotes,
  fallbackRemoteName = 'origin',
}: RemoteSelectContentProps) {
  return (
    <SelectContent align="start" alignItemWithTrigger={false} sideOffset={6}>
      {remotes.length > 0 ? (
        remotes.map((remote) => <RemoteSelectItem key={remote.name} remote={remote} />)
      ) : (
        <SelectItem value={fallbackRemoteName} className="py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="relative -top-px shrink-0 font-medium">{fallbackRemoteName}</span>
          </div>
        </SelectItem>
      )}
    </SelectContent>
  );
}

export function RemoteSelectItem({ remote }: { remote: GitRemote }) {
  return (
    <SelectItem value={remote.name} className="py-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="relative -top-px shrink-0">{remote.name}</span>
        {remote.url ? (
          <span className="min-w-0 flex-1 truncate text-xs text-foreground-muted">
            {remote.url}
          </span>
        ) : null}
      </div>
    </SelectItem>
  );
}
