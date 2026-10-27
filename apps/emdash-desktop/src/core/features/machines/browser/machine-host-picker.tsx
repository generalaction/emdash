import { Combobox, Field } from '@emdash/ui/react/primitives';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { SshConfigHost } from '@core/primitives/ssh/api';

export function MachineHostPicker({
  id,
  target,
  onTargetChange,
  hosts,
  disabled,
}: {
  id: string;
  target: string;
  onTargetChange: (target: string) => void;
  hosts: SshConfigHost[];
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const suggestions = hosts.filter((host) =>
    host.host.toLowerCase().includes(target.toLowerCase())
  );
  return (
    <Field.Root>
      <Combobox.Root
        items={suggestions.map((host) => host.host)}
        inputValue={target}
        onInputValueChange={(value, details) => {
          if (details.reason === 'input-change') onTargetChange(value);
        }}
        value={target || null}
        onValueChange={(value) => {
          if (value) onTargetChange(value);
        }}
        open={open}
        onOpenChange={setOpen}
        filter={null}
        disabled={disabled}
      >
        <Combobox.Input
          id={id}
          aria-label="Host"
          variant="default"
          showTrigger={false}
          rightAddon={
            <Combobox.Trigger aria-label="Show SSH config hosts">
              <ChevronDown className="size-4" />
            </Combobox.Trigger>
          }
          placeholder="Select or enter a host"
          autoComplete="off"
        />
        <Combobox.Content>
          <Combobox.Empty className="px-3">
            No saved hosts match. You can still resolve this hostname.
          </Combobox.Empty>
          <Combobox.List>
            <Combobox.Group>
              {suggestions.map((host) => (
                <Combobox.Item key={host.host} value={host.host}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{host.host}</span>
                    {host.hostname && (
                      <span className="truncate text-xs text-foreground-muted">
                        {host.user ? `${host.user}@` : ''}
                        {host.hostname}
                      </span>
                    )}
                  </span>
                </Combobox.Item>
              ))}
            </Combobox.Group>
          </Combobox.List>
        </Combobox.Content>
      </Combobox.Root>
      <Field.Description>
        Choose a host from your SSH config, or enter a hostname. OpenSSH will resolve its connection
        settings.
      </Field.Description>
    </Field.Root>
  );
}
