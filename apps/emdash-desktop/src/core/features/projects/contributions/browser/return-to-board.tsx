import { Button } from '@emdash/ui/react/primitives';
import { X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { getProjectViewStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';

export const ReturnToBoard = observer(function ReturnToBoard({ projectId }: { projectId: string }) {
  const view = getProjectViewStore(projectId);
  const { navigate } = useNavigate();
  if (view?.activeView !== 'board') return null;

  return (
    <Button
      variant="ghost"
      size="sm"
      icon
      aria-label="Close task and return to board"
      title="Return to board"
      onClick={() => navigate(projectViewDef({ projectId }))}
    >
      <X className="size-3.5" />
    </Button>
  );
});
