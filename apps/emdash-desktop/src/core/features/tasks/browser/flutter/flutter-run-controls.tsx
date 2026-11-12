import { Button, toast, Tooltip } from '@emdash/ui/react/primitives';
import { Loader2, Play, RotateCcw, Square } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { getFlutterRunner } from '@core/features/tasks/api/browser/flutter/flutter-runner';
import { useTaskViewContext } from '@core/features/tasks/contributions/browser/task-view-context';
import {
  usePreviewServers,
  useTaskComposition,
  useTerminals,
  useWorkspaceId,
} from '@core/features/workbench/api/browser/task-composition-context';
import { log } from '@core/primitives/logging/browser/logger';
import { cn } from '@core/primitives/styling/browser/cn';

/** Run / Stop / Hot Restart buttons for Flutter workspaces; DevTools shows up as a preview pill. */
export const FlutterRunControls = observer(function FlutterRunControls() {
  const { projectId, taskId } = useTaskViewContext();
  const taskView = useTaskComposition();
  const runner = getFlutterRunner(
    projectId,
    taskId,
    useWorkspaceId(),
    useTerminals(),
    usePreviewServers()
  );

  useEffect(() => {
    runner.detectFlutter().catch((error) => log.warn('Flutter detection failed', { error }));
  }, [runner]);

  if (!runner.isFlutter) return null;

  const state = runner.state;

  if (state === 'starting' || state === 'running') {
    return (
      <div className="flex items-center gap-1">
        <IconButton
          label={state === 'starting' ? 'Cancel build' : 'Stop'}
          className="group"
          onClick={() => void runner.stop()}
        >
          {state === 'starting' && (
            <Loader2 className="size-3.5 animate-spin text-foreground-muted group-hover:hidden" />
          )}
          <Square
            className={cn(
              'size-3.5 text-foreground-destructive',
              state === 'starting' && 'hidden group-hover:block'
            )}
          />
        </IconButton>
        <IconButton
          label="Hot Restart"
          disabled={state !== 'running'}
          onClick={() => void runner.hotRestart()}
        >
          <RotateCcw className="size-3.5 text-foreground-success" />
        </IconButton>
      </div>
    );
  }

  const device = runner.onlineDevice;
  return (
    <IconButton
      label={device ? `Run on ${device.name}` : 'No device'}
      disabled={state === 'busy'}
      onClick={() => {
        // Re-list first: the device may have shut down since the list was loaded.
        void runner
          .refreshTargets()
          .then(async () => {
            const online = runner.onlineDevice;
            if (!online) {
              toast.error('No device');
              return;
            }
            await runner.run({ kind: 'device', device: online });
            if (runner.terminalId) taskView.revealTerminal(runner.terminalId);
          })
          .catch((error) => log.warn('Flutter run failed', { error }));
      }}
    >
      <Play className="size-3.5" />
    </IconButton>
  );
});

function IconButton({
  label,
  className,
  disabled,
  onClick,
  children,
}: {
  label: string;
  className?: string;
  disabled?: boolean;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger>
        <Button
          variant="ghost"
          size="xs"
          className={className}
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip.Root>
  );
}
