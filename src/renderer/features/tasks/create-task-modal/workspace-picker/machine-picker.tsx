import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { ChevronDown, Laptop, Monitor, Server, X } from 'lucide-react';
import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { appState } from '@renderer/lib/stores/app-state';
import { cn } from '@renderer/utils/utils';
import { buildPickerItems, type PickerHostItem } from './workspace-picker-items';
import { connectionStateDot } from './workspace-picker-rows';
import { useWorkspacePickerData } from './use-workspace-picker-data';

interface MachinePickerProps {
  projectId: string;
  value: string | null;
  onChange: (hostKey: string | null) => void;
  triggerClassName?: string;
}

function MachineTriggerContent({ host }: { host: PickerHostItem }) {
  const connState =
    host.kind === 'ssh' && host.connectionId
      ? appState.sshConnections.stateFor(host.connectionId)
      : null;

  return (
    <div className="flex h-14 flex-col gap-0.5 justify-center px-2.5 hover:bg-background-2 transition-colors w-full bg-background-2 border-b">
      {/* <span className="text-xs text-foreground-muted w-full text-left">Machine</span> */}
      <span className="flex items-center gap-1.5 text-sm text-foreground">
        {host.kind === 'local' ? (
          <Laptop absoluteStrokeWidth strokeWidth={1.5} className="size-3.5 shrink-0 text-foreground-muted" />
        ) : (
          <Server absoluteStrokeWidth strokeWidth={1.5} className="size-3.5 shrink-0 text-foreground-muted" />
        )}
        <span className="truncate">{host.label}</span>
        {connState && connectionStateDot(connState)}
      </span>
    </div>
  );
}

export const MachinePicker = observer(function MachinePicker({
  projectId,
  value,
  onChange,
  triggerClassName,
}: MachinePickerProps) {
  const [open, setOpen] = useState(false);
  const data = useWorkspacePickerData(projectId);

  const hostItems = buildPickerItems(data, { includeWorktrees: false }).filter(
    (i): i is PickerHostItem => i.type === 'host'
  );

  const selectedHost = hostItems.find((h) => h.hostKey === value);

  const handleSelect = (hostKey: string) => {
    onChange(hostKey === value ? null : hostKey);
    setOpen(false);
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <div className="group relative">
        <PopoverPrimitive.Trigger
          className={cn('w-full h-14', triggerClassName)}
          render={<button type="button" />}
        >
          {selectedHost ? (
            <MachineTriggerContent host={selectedHost} />
          ) : (
            <div className="flex items-center gap-2 px-2.5 h-full text-sm text-foreground-passive hover:bg-background-2 transition-colors">
              <Monitor absoluteStrokeWidth strokeWidth={1.5} className="size-3.5 shrink-0" />
              <span>Select a machine…</span>
              <div className="flex-1" />
              <ChevronDown absoluteStrokeWidth strokeWidth={2} className="size-3.5 shrink-0" />
            </div>
          )}
        </PopoverPrimitive.Trigger>
        {value && (
          <button
            type="button"
            aria-label="Clear selection"
            onClick={() => onChange(null)}
            className="absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-foreground-muted opacity-0 hover:bg-background-2 hover:text-foreground group-hover:opacity-100"
          >
            <X absoluteStrokeWidth strokeWidth={2} className="size-3.5" />
          </button>
        )}
      </div>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          side="bottom"
          align="start"
          sideOffset={4}
          className="isolate z-50"
        >
          <PopoverPrimitive.Popup
            className={cn(
              'flex w-(--anchor-width) min-w-48 flex-col overflow-hidden rounded-md bg-background-quaternary text-sm text-foreground shadow-md ring-1 ring-foreground/10 outline-hidden',
              'origin-(--transform-origin) duration-100 data-[side=bottom]:slide-in-from-top-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95'
            )}
          >
            {hostItems.map((h) => {
              const connState =
                h.kind === 'ssh' && h.connectionId
                  ? appState.sshConnections.stateFor(h.connectionId)
                  : null;

              return (
                <button
                  key={h.hostKey}
                  type="button"
                  onClick={() => handleSelect(h.hostKey)}
                  className={cn(
                    'flex h-8 w-full items-center gap-2 px-2.5 text-left text-sm transition-colors',
                    h.hostKey === value
                      ? 'bg-background-2 text-foreground'
                      : 'text-foreground-muted hover:bg-background-1 hover:text-foreground'
                  )}
                >
                  {h.kind === 'local' ? (
                    <Laptop absoluteStrokeWidth strokeWidth={1.5} className="size-3.5 shrink-0" />
                  ) : (
                    <Server absoluteStrokeWidth strokeWidth={1.5} className="size-3.5 shrink-0" />
                  )}
                  <span className="flex-1 truncate">{h.label}</span>
                  {connState && connectionStateDot(connState)}
                </button>
              );
            })}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
});
