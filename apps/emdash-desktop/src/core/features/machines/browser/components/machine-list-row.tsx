import { MachineStatus } from '@emdash/ui/react/components';
import { observer } from 'mobx-react-lite';
import { getMachinesStore } from '@core/features/machines/contributions/app-stores';
import type { SshConfig } from '@core/primitives/ssh/api';
import { useMachineStatusKind } from '../use-machine-status-kind';

/** Freeform row content for the Machines CollectionView; the shell owns click handling. */
export const MachineListRow = observer(function MachineListRow({
  machine,
}: {
  machine: SshConfig;
}) {
  const connectionState = getMachinesStore().stateFor(machine.id);
  const machineStatus = useMachineStatusKind({
    machineId: machine.id,
    connectionState,
  });

  return (
    <div className="flex min-w-0 items-center gap-3">
      <MachineStatus status={machineStatus} size="1.25rem" />
      <span className="truncate text-sm text-foreground">{machine.name}</span>
    </div>
  );
});
