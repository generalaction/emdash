import { ArrowUp } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { selectAheadCount } from '@renderer/features/tasks/diff-view/stores/diff-selectors';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';

export const PushCard = observer(function PushCard() {
  const git = useProvisionedTask().workspace.git;
  const ahead = selectAheadCount(git);

  return (
    <div className="shrink-0 mx-2 mb-2 flex flex-col gap-2 items-center justify-between rounded-lg border border-border  p-2.5">
      <Button variant="default" size="sm" className="w-full" onClick={() => git.push()}>
        <ArrowUp className="size-3" />
        Push changes
        <Badge variant="secondary">{ahead}</Badge>
      </Button>
    </div>
  );
});
