import { ArrowUp } from 'lucide-react';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { useTaskViewContext } from '../../task-view-context';
import { useBranchStatus } from '../state/use-branch-status';

export function PushCard() {
  const { projectId, taskId } = useTaskViewContext();
  const { pushChanges, data } = useBranchStatus({ projectId, taskId });

  return (
    <div className="shrink-0 mx-2 mb-2 flex flex-col gap-2 items-center justify-between rounded-lg border border-border  p-2.5">
      <Button variant="default" size="sm" className="w-full" onClick={() => pushChanges()}>
        <ArrowUp className="size-3" />
        Push changes
        <Badge variant="secondary">{data?.ahead ?? 0}</Badge>
      </Button>
    </div>
  );
}
