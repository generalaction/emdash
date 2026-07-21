import { ListPage } from '@emdash/ui/react/patterns';
import { ServerIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { SshConfig } from '@core/primitives/ssh/api';
import { appState } from '@renderer/lib/stores/app-state';
import { MachineBadge } from './MachineBadge';

export const MachineListRow = observer(function MachineListRow({
  machine,
  onSelect,
}: {
  machine: SshConfig;
  onSelect: (machine: SshConfig) => void;
}) {
  const state = appState.machines.stateFor(machine.id);

  return (
    <ListPage.Row onClick={() => onSelect(machine)} aria-label={`Edit ${machine.name}`}>
      <ListPage.RowIcon>
        <ServerIcon className="size-4" />
      </ListPage.RowIcon>
      <ListPage.RowContent>
        <ListPage.RowTitle>{machine.name}</ListPage.RowTitle>
      </ListPage.RowContent>
      <ListPage.RowTrailing>
        <MachineBadge state={state} />
      </ListPage.RowTrailing>
    </ListPage.Row>
  );
});
