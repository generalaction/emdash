import { Button, Surface } from '@emdash/ui/react/primitives';
import { SettingsIcon } from 'lucide-react';
import type { ConnectionState, SshConfig } from '@core/primitives/ssh/api';
import { authLabel } from './machine-formatters';
import { MachineBadge } from './MachineBadge';

export function MachineConnectionCard({
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

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">SSH Connection</h3>
        <Button
          type="button"
          variant={active ? 'ghost' : 'primary'}
          size="sm"
          onClick={() => void (active ? onDisconnect() : onConnect())}
        >
          {active ? 'Disconnect' : 'Connect'}
        </Button>
      </div>
      <Surface
        emphasis
        className="bg-surface flex items-center gap-3 rounded-md border border-border px-3 py-3"
      >
        <MachineBadge state={state} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-foreground">
            {machine.host} | {machine.username} | {authLabel(machine)}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon
          aria-label="Edit connection settings"
          onClick={onEdit}
        >
          <SettingsIcon />
        </Button>
      </Surface>
    </section>
  );
}
