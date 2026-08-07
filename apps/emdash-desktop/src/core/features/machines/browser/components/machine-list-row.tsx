import { MachineStatus } from '@emdash/ui/react/components';
import { ListPage } from '@emdash/ui/react/patterns';
import { observer } from 'mobx-react-lite';
import { getMachinesStore } from '@core/features/machines/contributions/app-stores';
import type { SshConfig } from '@core/primitives/ssh/api';
import { useMachineStatusKind } from '../use-machine-status-kind';

export const MachineListRow = observer(function MachineListRow({
  machine,
  onSelect,
}: {
  machine: SshConfig;
  onSelect: (machine: SshConfig) => void;
}) {
  const connectionState = getMachinesStore().stateFor(machine.id);
  const machineStatus = useMachineStatusKind({
    machineId: machine.id,
    connectionState,
  });

  return (
    <ListPage.Row onClick={() => onSelect(machine)} aria-label={`Edit ${machine.name}`}>
      <ListPage.RowIcon>
        <MachineStatus status={machineStatus} size="1.25rem" />
      </ListPage.RowIcon>
      <ListPage.RowContent>
        <ListPage.RowTitle>{machine.name}</ListPage.RowTitle>
      </ListPage.RowContent>
    </ListPage.Row>
  );
});
