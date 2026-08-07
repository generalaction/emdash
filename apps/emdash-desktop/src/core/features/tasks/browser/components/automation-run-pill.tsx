import { Button, MicroLabel, Popover, RelativeTime, Separator } from '@emdash/ui/react/primitives';
import { Clock } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import type { TaskStore } from '@core/features/tasks/api/browser/stores/task-store';
import { cn } from '@core/primitives/styling/browser/cn';
import { registeredTaskData } from '@core/primitives/task-state/browser/task-state';

type AutomationRunPillProps = {
  taskStore: TaskStore;
  isConverted: boolean;
};

export const AutomationRunPill = observer(function AutomationRunPill({
  taskStore,
  isConverted,
}: AutomationRunPillProps) {
  const [open, setOpen] = useState(false);
  const [isConverting, setIsConverting] = useState(false);

  const runMeta = registeredTaskData(taskStore)?.automationRunMeta;
  const timestamp = runMeta?.finishedAt ?? runMeta?.startedAt ?? runMeta?.scheduledAt ?? null;
  const automationName = runMeta?.automationName ?? 'Automation run';

  async function handleConvert() {
    setIsConverting(true);
    try {
      await taskStore.convertAutomationTask();
      setOpen(false);
    } finally {
      setIsConverting(false);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={cn(
          'ml-1 flex items-center gap-1.5 rounded-lg px-2 py-1 bg-background-1',
          'text-xs text-foreground-muted hover:border-border-muted hover:text-foreground',
          'transition-colors'
        )}
      >
        <Clock className="size-3" />
        <span className="max-w-28 truncate">{automationName}</span>
        {timestamp != null && (
          <RelativeTime value={timestamp} compact className="text-foreground-passive" />
        )}
      </Popover.Trigger>
      <Popover.Content align="start" className="flex w-72 flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
          <MicroLabel className="text-foreground-passive">Automation</MicroLabel>
          <span className="text-sm tracking-tight">{automationName}</span>
        </div>
        {timestamp != null && (
          <div className="flex flex-col gap-1">
            <MicroLabel className="text-foreground-passive">Run date</MicroLabel>
            <span className="text-sm">
              {new Date(timestamp).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </span>
          </div>
        )}
        {!isConverted && (
          <>
            <Separator />
            <div className="flex flex-col gap-1">
              <p className="text-xs text-foreground-muted">
                Convert to a regular task to manage it independently.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                disabled={isConverting}
                onClick={() => void handleConvert()}
              >
                {isConverting ? 'Converting…' : 'Convert to task'}
              </Button>
            </div>
          </>
        )}
      </Popover.Content>
    </Popover.Root>
  );
});
