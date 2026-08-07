import { Select } from '@emdash/ui/react/primitives';
import type { GitRemote } from '@core/primitives/git/api';

type RemoteSelectContentProps = {
  remotes: GitRemote[];
  fallbackRemoteName?: string;
};

export function RemoteSelectContent({
  remotes,
  fallbackRemoteName = 'origin',
}: RemoteSelectContentProps) {
  return (
    <Select.Content align="start" alignItemWithTrigger={false} sideOffset={6}>
      {remotes.length > 0 ? (
        remotes.map((remote) => <RemoteSelectItem key={remote.name} remote={remote} />)
      ) : (
        <Select.Item value={fallbackRemoteName} className="py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="relative -top-px shrink-0 font-medium">{fallbackRemoteName}</span>
          </div>
        </Select.Item>
      )}
    </Select.Content>
  );
}

export function RemoteSelectItem({ remote }: { remote: GitRemote }) {
  return (
    <Select.Item value={remote.name} className="py-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="relative -top-px shrink-0">{remote.name}</span>
        {remote.url ? (
          <span className="min-w-0 flex-1 truncate text-xs text-foreground-muted">
            {remote.url}
          </span>
        ) : null}
      </div>
    </Select.Item>
  );
}
