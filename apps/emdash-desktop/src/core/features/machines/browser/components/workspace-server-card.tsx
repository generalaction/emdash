import { Button, DropdownMenu, Surface } from '@emdash/ui/react/primitives';
import {
  ArrowUpRightIcon,
  DownloadIcon,
  EllipsisIcon,
  LoaderCircleIcon,
  PlayIcon,
  PowerIcon,
  RefreshCwIcon,
} from 'lucide-react';
import type { RemoteMachineServerState } from '@core/services/remote-machine/api';
import { rpc } from '@renderer/lib/runtime/desktop-host-client';
import { WorkspaceServerBadge } from './workspace-server-badge';

type WorkspaceServerActions = {
  install(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  update(): Promise<void>;
};

export function WorkspaceServerCard({
  connected,
  loading,
  state,
  actions,
}: {
  connected: boolean;
  loading: boolean;
  state: RemoteMachineServerState | undefined;
  actions: WorkspaceServerActions;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">Workspace server</h3>
        {connected && !loading && state && (
          <WorkspaceServerAction state={state} actions={actions} />
        )}
      </div>
      <Surface emphasis className="bg-surface rounded-md border border-border px-3 py-3">
        {!connected ? (
          <p className="text-xs text-foreground-passive">
            Connect to this machine to inspect its workspace server.
          </p>
        ) : loading || !state ? (
          <div className="flex items-center gap-2 text-xs text-foreground-passive">
            <LoaderCircleIcon className="size-3.5 animate-spin" />
            Checking workspace server…
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <WorkspaceServerBadge status={state.status} />
              {state.version && (
                <span className="text-xs text-foreground-passive tabular-nums">
                  v{state.version}
                </span>
              )}
            </div>
            {state.startedAt !== undefined && state.status === 'healthy' && (
              <p className="mt-2 text-xs text-foreground-passive">
                Started {new Date(state.startedAt).toLocaleString()}
              </p>
            )}
            {state.detail && <p className="mt-2 text-xs text-foreground-passive">{state.detail}</p>}
            {state.error && <p className="text-destructive mt-2 text-xs">{state.error.message}</p>}
            <Button
              type="button"
              variant="link"
              size="sm"
              className="mt-2 h-auto gap-1 px-0 text-xs"
              onClick={() => void rpc.app.openExternal('https://docs.emdash.sh')}
            >
              Learn More
              <ArrowUpRightIcon className="size-3" />
            </Button>
          </>
        )}
      </Surface>
    </section>
  );
}

function WorkspaceServerAction({
  state,
  actions,
}: {
  state: RemoteMachineServerState;
  actions: WorkspaceServerActions;
}) {
  const transitioning = state.status === 'booting' || state.status === 'shutting-down';

  if (state.status === 'not-installed') {
    return (
      <Button
        type="button"
        variant="primary"
        size="sm"
        disabled={transitioning}
        onClick={() => void actions.install()}
      >
        <DownloadIcon />
        Install
      </Button>
    );
  }

  if (state.status === 'stopped') {
    return (
      <Button
        type="button"
        variant="primary"
        size="sm"
        disabled={transitioning}
        onClick={() => void actions.start()}
      >
        <PlayIcon />
        Start
      </Button>
    );
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        disabled={transitioning}
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon
            aria-label="Workspace server actions"
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        {(state.status === 'healthy' || state.status === 'failed') && (
          <DropdownMenu.Item onClick={() => void actions.restart()}>
            <RefreshCwIcon />
            Restart
          </DropdownMenu.Item>
        )}
        <DropdownMenu.Item onClick={() => void actions.update()}>
          <DownloadIcon />
          Update
        </DropdownMenu.Item>
        {state.status === 'healthy' && (
          <>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onClick={() => void actions.stop()}>
              <PowerIcon />
              Shutdown
            </DropdownMenu.Item>
          </>
        )}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
