import { SettingsRow } from '@emdash/ui/react/patterns';
import { Button } from '@emdash/ui/react/primitives';
import { Cog, PlugIcon } from 'lucide-react';
import type { ConnectionState, SshConfig } from '@core/primitives/ssh/api';
import { authLabel } from './machine-formatters';
import { MachineBadge } from './MachineBadge';

export function MachineConnectionRow({
  machine,
  state,
  onEdit,
  onConnect,
  onDisconnect,
}: {
  machine: SshConfig;
  state: ConnectionState;
  onEdit: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const active = state === 'connected' || state === 'connecting' || state === 'reconnecting';
  const transitioning = state === 'connecting' || state === 'reconnecting';

  return (
    <SettingsRow
      label={
        <span className="flex items-center gap-2">
          SSH Connection
          <MachineBadge state={state} />
        </span>
      }
      description={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            {machine.host} · {machine.username} · {authLabel(machine)}
          </span>

        </span>
      }
      control={
        active ? (
          <span className="flex items-center gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={transitioning}
              onClick={onDisconnect}
            >
              Disconnect
            </Button>
            <Button type="button" variant="secondary" size="sm" icon onClick={onEdit}><Cog /></Button>
          </span>
        ) : (
          <span className="flex items-center gap-2">
          <Button type="button" variant="primary" size="sm" onClick={onConnect}>
            <PlugIcon />
            Connect
          </Button>
          <Button type="button" variant="secondary" size="sm" icon onClick={onEdit}><Cog /></Button>
          </span>
        )
      }
    />
  );
}
