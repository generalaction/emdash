import { ChevronsUpDownIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { appState } from '@renderer/lib/stores/app-state';
import { ComboboxTrigger, ComboboxValue } from '@renderer/lib/ui/combobox';
import { ComboboxPopover } from '@renderer/lib/ui/combobox-popover';

interface SshConnectionSelectorProps {
  connectionId?: string;
  onConnectionIdChange: (connectionId: string) => void;
  onAddConnection: () => void;
  onEditConnection?: (connectionId: string) => void;
  onDeleteConnection?: (connectionId: string) => void;
}

export const SshConnectionSelector = observer(function SshConnectionSelector({
  connectionId,
  onConnectionIdChange,
  onAddConnection,
  onEditConnection,
  onDeleteConnection,
}: SshConnectionSelectorProps) {
  const { connections } = appState.sshConnections;

  const options = connections
    .filter((c): c is typeof c & { id: string } => c.id !== undefined)
    .map((connection) => ({
      value: connection.id,
      label: connection.name,
    }));

  const selectedOption = connectionId
    ? (options.find((o) => o.value === connectionId) ?? null)
    : null;

  const actions = [
    {
      id: 'add',
      label: 'Add Connection',
      icon: <PlusIcon className="size-4" />,
      onClick: onAddConnection,
    },
    ...(connectionId && onEditConnection
      ? [
          {
            id: 'edit',
            label: 'Edit Connection',
            icon: <PencilIcon className="size-4" />,
            onClick: () => onEditConnection(connectionId),
          },
        ]
      : []),
    ...(connectionId && onDeleteConnection
      ? [
          {
            id: 'delete',
            label: 'Delete Connection',
            icon: <Trash2Icon className="size-4" />,
            onClick: () => onDeleteConnection(connectionId),
          },
        ]
      : []),
  ];

  return (
    <ComboboxPopover
      items={options}
      value={selectedOption}
      onValueChange={(conn) => onConnectionIdChange(conn.value)}
      actions={actions}
      trigger={
        <ComboboxTrigger
          render={
            <button
              type="button"
              className="flex h-9 w-full min-w-0 items-center justify-between rounded-md border border-border px-2.5 py-1 text-left text-sm outline-none"
            >
              <span className="min-w-0 truncate">
                <ComboboxValue
                  placeholder={
                    <p className="text-muted-foreground min-w-0 truncate">
                      Select or add a connection
                    </p>
                  }
                />
              </span>
              <ChevronsUpDownIcon className="text-muted-foreground size-4 shrink-0" />
            </button>
          }
        />
      }
    />
  );
});
