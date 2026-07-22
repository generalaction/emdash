import { MachineStatus } from '@emdash/ui/react/components';
import { ListPage } from '@emdash/ui/react/patterns';
import { observer } from 'mobx-react-lite';
import type { SshConfig } from '@core/primitives/ssh/api';
import { appState } from '@renderer/lib/stores/app-state';
import { useRemoteMachineServerState } from '../use-remote-machine-server-state';
import { deriveMachineStatusKind } from './machine-status-kind';

export const MachineListRow = observer(function MachineListRow({
  machine,
  onSelect,
}: {
  machine: SshConfig;
  onSelect: (machine: SshConfig) => void;
}) {
  const state = appState.machines.stateFor(machine.id);
  const connected = state === 'connected';
  const workspaceServer = useRemoteMachineServerState({
    machineId: machine.id,
    enabled: connected,
    connected,
  });
  const machineStatus = deriveMachineStatusKind({
    connectionState: state,
    workspaceServerStatus: workspaceServer.state?.status,
    workspaceServerLoading: workspaceServer.loading,
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
