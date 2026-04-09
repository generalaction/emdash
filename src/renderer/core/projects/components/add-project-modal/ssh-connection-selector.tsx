import { ChevronsUpDownIcon, PlusIcon } from 'lucide-react';
import { ComboboxTrigger, ComboboxValue } from '@renderer/components/ui/combobox';
import { ComboboxPopover } from '@renderer/components/ui/combobox-popover';
import { useSshConnectionContext } from '@renderer/providers/ssh-connection-provider';

interface SshConnectionSelectorProps {
  connectionId?: string;
  onConnectionIdChange: (connectionId: string) => void;
  onAddConnection: () => void;
}

export function SshConnectionSelector({
  connectionId,
  onConnectionIdChange,
  onAddConnection,
}: SshConnectionSelectorProps) {
  const { connections } = useSshConnectionContext();

  const options = connections
    .filter((c): c is typeof c & { id: string } => c.id !== undefined)
    .map((connection) => ({
      value: connection.id,
      label: connection.name,
    }));

  return (
    <ComboboxPopover
      items={options}
      defaultValue={
        connectionId
          ? {
              value: connectionId,
              label: options.find((o) => o.value === connectionId)?.label ?? connectionId,
            }
          : options[0]
      }
      onValueChange={(conn) => onConnectionIdChange(conn.value)}
      actions={[
        {
          id: 'add',
          label: 'Add Connection',
          icon: <PlusIcon className="size-4" />,
          onClick: onAddConnection,
        },
      ]}
      trigger={
        <ComboboxTrigger
          render={
            <button className="flex h-9 w-full min-w-0 items-center justify-between rounded-md border border-border px-2.5 py-1 text-left text-sm outline-none">
              <ComboboxValue
                placeholder={<p className="text-muted-foreground">Select or add a connection</p>}
              />
              <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
            </button>
          }
        />
      }
    />
  );
}
