import { MachineStatus, type MachineStatusKind } from '@emdash/ui/react/components';
import { CollectionViewCell } from '@emdash/ui/react/patterns';
import { observer } from 'mobx-react-lite';
import type { SshConfig } from '@core/primitives/ssh/api';
import { useMachineStatusKind } from '../use-machine-status-kind';

const STATUS_TEXT: Record<MachineStatusKind, string> = {
  successful: 'Connected',
  initializing: 'Connecting…',
  error: 'Connection issue',
  idle: 'Not connected',
};

function machineEndpoint(machine: SshConfig): string {
  const host = machine.sshConfigAlias?.trim() || machine.host;
  const target = machine.username ? `${machine.username}@${host}` : host;
  return machine.port !== 22 ? `${target}:${machine.port}` : target;
}

/** Freeform row content for the Machines CollectionView; the shell owns click handling. */
export const MachineListRow = observer(function MachineListRow({
  machine,
}: {
  machine: SshConfig;
}) {
  const machineStatus = useMachineStatusKind({
    machineId: machine.id,
  });

  return (
    <div className="group flex w-full min-w-0 items-center gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background-1 group-hover:bg-background-2">
        <MachineStatus status={machineStatus} size="1.25rem" />
      </div>
      <CollectionViewCell
        className="min-w-0 flex-1"
        primary={machine.name}
        secondary={machineEndpoint(machine)}
      />
      <span className="shrink-0 text-xs text-foreground-muted">{STATUS_TEXT[machineStatus]}</span>
    </div>
  );
});
