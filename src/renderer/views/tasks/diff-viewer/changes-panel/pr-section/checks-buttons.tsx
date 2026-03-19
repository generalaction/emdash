import { CircleCheckBig } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { useModalContext } from '@renderer/core/modal/modal-provider';
import { cn } from '@renderer/lib/utils';
import { useCheckRuns } from '../../state/use-check-runs';

export function ChecksButton({
  nameWithOwner,
  prNumber,
}: {
  nameWithOwner: string;
  prNumber: number;
}) {
  const { summary, allComplete, hasFailures, isLoading } = useCheckRuns(nameWithOwner, prNumber);
  const { showModal } = useModalContext();

  const dotColor = isLoading
    ? 'bg-muted-foreground'
    : !allComplete
      ? 'bg-amber-500 animate-pulse'
      : hasFailures
        ? 'bg-red-500'
        : summary.total > 0
          ? 'bg-emerald-500'
          : 'bg-muted-foreground';

  return (
    <Button
      variant="outline"
      size="icon-xs"
      title="Checks & comments"
      onClick={() => showModal('checksCommentsModal', { nameWithOwner, prNumber })}
      className="relative"
    >
      <CircleCheckBig className="size-3" />
      <span className={cn('absolute -top-0.5 -right-0.5 size-2 rounded-full', dotColor)} />
    </Button>
  );
}
