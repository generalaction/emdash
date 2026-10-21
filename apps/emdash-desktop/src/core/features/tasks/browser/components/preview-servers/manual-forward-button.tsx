import { Dialog, Tooltip } from '@emdash/ui/react/primitives';
import { Globe, Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTaskComposition } from '@core/features/workbench/api/browser/task-composition-context';
import { projectAvailabilityUi } from '@core/manifests/browser/project-availability-ui';
import { ManualForwardDialog } from './manual-forward-dialog';

export const ManualForwardButton = observer(function ManualForwardButton() {
  const [open, setOpen] = useState(false);
  const taskView = useTaskComposition();
  const disabledReason = projectAvailabilityUi.getLiveActionDisabledReason(taskView.projectId);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !disabledReason && setOpen(next)}>
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <span
              className="inline-flex"
              tabIndex={disabledReason ? 0 : undefined}
              aria-label={disabledReason ?? undefined}
            />
          }
        >
          <button
            type="button"
            disabled={Boolean(disabledReason)}
            className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs text-foreground-muted transition-colors hover:bg-background-1 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Forward remote port"
            onClick={() => setOpen(true)}
          >
            <Plus className="size-3.5" />
            <Globe className="size-3.5" />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Content>{disabledReason ?? 'Forward remote port'}</Tooltip.Content>
      </Tooltip.Root>
      <ManualForwardDialog onClose={() => setOpen(false)} />
    </Dialog.Root>
  );
});
