import { DropdownMenu } from '@emdash/ui/react/primitives';
import { Check, Smartphone } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import {
  getFlutterRunner,
  type FlutterRunMode,
  type FlutterRunTarget,
} from '@core/features/tasks/api/browser/flutter/flutter-runner';
import { useTaskViewContext } from '@core/features/tasks/contributions/browser/task-view-context';
import {
  usePreviewServers,
  useTerminals,
  useWorkspaceId,
} from '@core/features/workbench/api/browser/task-composition-context';
import { log } from '@core/primitives/logging/browser/logger';
import { cn } from '@core/primitives/styling/browser/cn';

/** Status-bar device chip for Flutter workspaces: shows the run target, click to change it. */
export const FlutterDevicePicker = observer(function FlutterDevicePicker() {
  const { projectId, taskId } = useTaskViewContext();
  const runner = getFlutterRunner(
    projectId,
    taskId,
    useWorkspaceId(),
    useTerminals(),
    usePreviewServers()
  );

  useEffect(() => {
    // Device list loads up front so the chip only names a device that is online.
    runner
      .detectFlutter()
      .then(() => (runner.isFlutter && !runner.targets ? runner.refreshTargets() : undefined))
      .catch((error) => log.warn('Flutter detection failed', { error }));
  }, [runner]);

  if (!runner.isFlutter) return null;

  const select = (target: FlutterRunTarget) => {
    runner.selectTarget(target).catch((error) => log.warn('Selecting device failed', { error }));
  };
  const onOpenChange = (open: boolean) => {
    if (!open) return;
    runner.refreshTargets().catch((error) => log.warn('Listing Flutter devices failed', { error }));
  };
  const targets = runner.targets;
  const current = runner.onlineDevice;

  return (
    <DropdownMenu.Root onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger
        disabled={runner.state === 'busy'}
        title={current ? `Run target: ${current.name}` : 'No running device'}
        className="flex min-w-0 items-center gap-1 rounded-sm hover:text-foreground disabled:opacity-50"
      >
        <Smartphone
          className={cn('size-3 shrink-0', runner.state === 'running' && 'text-foreground-success')}
        />
        <span className="truncate text-xs">{current?.name ?? 'No device'}</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content width="content" align="start" side="top" className="min-w-56">
        <DropdownMenu.Group>
          <DropdownMenu.Label>Run mode</DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={runner.mode}
            onValueChange={(mode) => runner.setMode(mode as FlutterRunMode)}
          >
            <DropdownMenu.RadioItem value="run" closeOnClick={false}>
              Run Without Debugging
            </DropdownMenu.RadioItem>
            <DropdownMenu.RadioItem value="debug" closeOnClick={false}>
              Start Debugging
            </DropdownMenu.RadioItem>
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Group>
        <DropdownMenu.Separator />
        {!targets ? (
          <DropdownMenu.Group>
            <DropdownMenu.Label>Loading devices…</DropdownMenu.Label>
          </DropdownMenu.Group>
        ) : (
          <>
            <DropdownMenu.Group>
              <DropdownMenu.Label>Devices</DropdownMenu.Label>
              {targets.devices.length === 0 && (
                <DropdownMenu.Label>No running devices</DropdownMenu.Label>
              )}
              {targets.devices.map((device) => (
                <DropdownMenu.Item
                  key={device.id}
                  onClick={() => select({ kind: 'device', device })}
                >
                  <Check className={cn('size-3.5', device.id !== current?.id && 'invisible')} />
                  {device.name}
                  <DropdownMenu.Shortcut>{device.platform}</DropdownMenu.Shortcut>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Group>
            {targets.emulators.length > 0 && (
              <>
                <DropdownMenu.Separator />
                <DropdownMenu.Group>
                  <DropdownMenu.Label>Offline emulators · click to boot</DropdownMenu.Label>
                  {targets.emulators.map((emulator) => (
                    <DropdownMenu.Item
                      key={emulator.id}
                      onClick={() => select({ kind: 'emulator', emulator })}
                    >
                      <Smartphone className="size-3.5" />
                      Start {emulator.name}
                      <DropdownMenu.Shortcut>{emulator.platform}</DropdownMenu.Shortcut>
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Group>
              </>
            )}
          </>
        )}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
});
