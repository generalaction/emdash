import { ArrowUp } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { selectAheadCount } from '@renderer/core/stores/diff-selectors';
import { useProvisionedTask } from '@renderer/views/tasks/task-view-context';

export const PushCard = observer(function PushCard() {
  const git = useProvisionedTask()?.git;
  const ahead = git ? selectAheadCount(git) : 0;

  return (
    <div className="shrink-0 mx-2 mb-2 flex flex-col gap-2 items-center justify-between rounded-lg border border-border  p-2.5">
      <Button variant="default" size="sm" className="w-full" onClick={() => git?.push()}>
        <ArrowUp className="size-3" />
        Push changes
        <Badge variant="secondary">{ahead}</Badge>
      </Button>
    </div>
  );
});
