import { SettingsRow } from '@emdash/ui/react/patterns';
import { Alert, Button, SplitButton } from '@emdash/ui/react/primitives';
import { DownloadIcon, LoaderCircleIcon, PlayIcon, RefreshCwIcon } from 'lucide-react';
import type { RemoteMachineServerState } from '@core/services/remote-machine/api';
import { WorkspaceServerBadge } from './workspace-server-badge';

type WorkspaceServerActions = {
  install(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  update(): Promise<void>;
};

export function WorkspaceRuntimeRow({
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
  const updateAvailable =
    state?.version !== undefined &&
    state.latestVersion !== undefined &&
    state.version !== state.latestVersion;

  return (
    <div className="flex flex-col gap-3">
      <SettingsRow
        label={
          <span className="flex items-center gap-2">
            Workspace Runtime
            {connected && !loading && state && <WorkspaceServerBadge status={state.status} />}
          </span>
        }
        description={
          <WorkspaceRuntimeDetails connected={connected} loading={loading} state={state} />
        }
        control={
          connected && !loading && state ? (
            <WorkspaceServerAction state={state} actions={actions} />
          ) : null
        }
      />
      {state && updateAvailable && (
        <Alert.Root status="warning" icon={<RefreshCwIcon />}>
          <Alert.Title>Update Available</Alert.Title>
          <div className="flex items-center gap-3">
            <Alert.Description className="min-w-0 flex-1 tabular-nums">
              v{state.version} → v{state.latestVersion}
            </Alert.Description>
            <Button type="button" variant="primary" size="sm" onClick={() => void actions.update()}>
              Update
            </Button>
          </div>
        </Alert.Root>
      )}
    </div>
  );
}

function WorkspaceRuntimeDetails({
  connected,
  loading,
  state,
}: {
  connected: boolean;
  loading: boolean;
  state: RemoteMachineServerState | undefined;
}) {
  if (!connected) return 'Connect to this machine to inspect its workspace runtime.';

  if (loading || !state) {
    return (
      <span className="flex items-center gap-2">
        <LoaderCircleIcon className="size-3.5 animate-spin" />
        Checking workspace runtime…
      </span>
    );
  }

  const startedAt =
    state.startedAt !== undefined && state.status === 'healthy'
      ? new Date(state.startedAt).toLocaleString()
      : undefined;

  return (
    <span className="flex flex-col gap-1">
      {(state.version || startedAt) && (
        <span className="flex flex-wrap items-center gap-2">
          {state.version && <span className="tabular-nums">Runtime v{state.version}</span>}
          {state.version && startedAt && <span aria-hidden>·</span>}
          {startedAt && <span>Started {startedAt}</span>}
        </span>
      )}
      {state.detail && <span>{state.detail}</span>}
      {state.error && <span className="text-destructive">{state.error.message}</span>}
    </span>
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

  if (
    state.status === 'healthy' ||
    state.status === 'failed' ||
    state.status === 'booting' ||
    state.status === 'shutting-down'
  ) {
    return (
      <SplitButton
        options={[
          {
            id: 'restart',
            label: 'Restart',
          },
          {
            id: 'shutdown',
            label: 'Shutdown',
          },
        ]}
        selectedId="restart"
        onAction={(id) => {
          if (id === 'shutdown') {
            void actions.stop();
            return;
          }
          void actions.restart();
        }}
        variant="secondary"
        size="sm"
        disabled={transitioning}
      />
    );
  }

  return null;
}
