import { Collapsible, Tooltip } from '@emdash/ui/react/primitives';
import { InfoIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { MachineEditorForm } from './use-machine-form';

function FieldInfoTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <button
            type="button"
            className="focus-visible:ring-primary/30 relative inline-flex size-4 shrink-0 items-center justify-center rounded-full text-foreground-passive transition-colors before:absolute before:-inset-2.5 before:content-[''] hover:text-foreground focus-visible:ring-2 focus-visible:outline-none"
            aria-label={`About ${label}`}
          >
            <InfoIcon className="size-3.5" aria-hidden="true" />
          </button>
        }
      />
      <Tooltip.Content
        side="top"
        align="start"
        className="max-w-[240px] items-start text-left leading-relaxed whitespace-normal"
      >
        {children}
      </Tooltip.Content>
    </Tooltip.Root>
  );
}

function FieldLabelWithInfo({ label, info }: { label: string; info: ReactNode }) {
  return (
    <span className="flex w-fit items-center gap-1.5">
      {label}
      <FieldInfoTooltip label={label}>{info}</FieldInfoTooltip>
    </span>
  );
}

export function MachineManualFields({ form }: { form: MachineEditorForm }) {
  return (
    <>
      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <form.AppField name="manual.host">
          {(field) => <field.TextField label="Host" placeholder="203.0.113.10" />}
        </form.AppField>
        <form.AppField name="manual.port">
          {(field) => <field.NumberField label="Port" />}
        </form.AppField>
      </div>
      <form.AppField name="manual.username">
        {(field) => <field.TextField label="Username" placeholder="ubuntu" autoComplete="off" />}
      </form.AppField>
    </>
  );
}

export function MachineManualRouting({ form }: { form: MachineEditorForm }) {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  return (
    <Collapsible.Root open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
      <div className="w-fit">
        <Collapsible.Trigger type="button">Advanced settings</Collapsible.Trigger>
      </div>
      <Collapsible.Panel className="grid gap-3 pt-2">
        <form.AppField name="manual.proxyJump">
          {(field) => (
            <field.TextField
              label={
                <FieldLabelWithInfo
                  label="Jump host"
                  info="Optional bastion host to connect through, for example user@bastion:2222."
                />
              }
              placeholder="bastion or user@bastion:2222"
              autoComplete="off"
            />
          )}
        </form.AppField>
        <form.AppField name="manual.forwardAgent">
          {(field) => (
            <field.SwitchField
              label={
                <FieldLabelWithInfo
                  label="Forward SSH agent"
                  info="Forward your local SSH agent to the remote server. Enable only for trusted hosts."
                />
              }
            />
          )}
        </form.AppField>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
