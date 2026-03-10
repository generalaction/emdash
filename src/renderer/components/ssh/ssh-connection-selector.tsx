import { ChevronsUpDownIcon, PlusIcon } from 'lucide-react';
import { ComboboxTrigger, ComboboxValue } from '../ui/combobox';
import { ComboboxPopover } from '../ui/combobox-popover';

const connections = Array.from({ length: 30 }, (_, index) => ({
  value: `connection-${index}`,
  label: `Connection ${index}`,
}));

interface SshConnectionSelectorProps {
  onValueChange: (connectionId: string) => void;
  onAddConnection: () => void;
}

export function SshConnectionSelector({
  onValueChange,
  onAddConnection,
}: SshConnectionSelectorProps) {
  return (
    <ComboboxPopover
      items={connections}
      defaultValue={connections[0]}
      onValueChange={(conn) => onValueChange(conn.value)}
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
              <ComboboxValue />
              <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
            </button>
          }
        />
      }
    />
  );
}
