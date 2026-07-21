import { Button, Sheet } from '@emdash/ui/react/primitives';
import { SettingsIcon, Trash2Icon } from 'lucide-react';
import type { SshConfig } from '@core/primitives/ssh/api';

export function MachineDetailsSheet({
  open,
  machine,
  deleting = false,
  onOpenChange,
  onEditConnectionSettings,
  onDelete,
}: {
  open: boolean;
  machine?: SshConfig;
  deleting?: boolean;
  onOpenChange: (open: boolean) => void;
  onEditConnectionSettings: (machine: SshConfig) => void;
  onDelete?: (machine: SshConfig) => void | Promise<void>;
}) {
  return (
    <Sheet.Root open={open} onOpenChange={onOpenChange}>
      <Sheet.Content side="right">
        <Sheet.Header>
          <Sheet.Title>{machine?.name ?? 'Machine'}</Sheet.Title>
        </Sheet.Header>
        <Sheet.Body>
          <p className="text-sm text-foreground-muted">
            Machine details are coming soon. Use Edit Connection Settings to update how Emdash
            connects to this machine.
          </p>
        </Sheet.Body>
        <Sheet.Footer>
          {machine && onDelete && (
            <Button
              type="button"
              variant="ghost"
              tone="destructive"
              disabled={deleting}
              onClick={() => void onDelete(machine)}
            >
              <Trash2Icon />
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          )}
          <Button
            type="button"
            variant="primary"
            disabled={!machine}
            onClick={() => machine && onEditConnectionSettings(machine)}
          >
            <SettingsIcon />
            Edit Connection Settings
          </Button>
        </Sheet.Footer>
      </Sheet.Content>
    </Sheet.Root>
  );
}
