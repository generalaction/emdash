import { Button, Surface } from '@emdash/ui/react/primitives';
import { SettingsIcon } from 'lucide-react';
import type { ConnectionState, SshConfig } from '@core/primitives/ssh/api';
import { authLabel } from './machine-formatters';
import { MachineBadge } from './MachineBadge';

export function MachineConnectionCard({
  machine,
  state,
  onEdit,
}: {
  machine: SshConfig;
  state: ConnectionState;
  onEdit: () => void;
}) {
  return (
    <Surface
      emphasis
      className="bg-surface flex items-center gap-4 rounded-md border border-border px-3 py-3"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{machine.host}</div>
        <div className="mt-0.5 truncate text-xs text-foreground-passive">
          {machine.username} | {authLabel(machine)}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
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
        <MachineBadge state={state} />
      </div>
    </Surface>
  );
}
