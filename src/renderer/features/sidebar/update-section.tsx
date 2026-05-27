import { observer } from 'mobx-react-lite';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { MicroLabel } from '@renderer/lib/ui/label';

export const UpdateSection = observer(function UpdateSection() {
  const update = appState.update;

  if (update.hasUpdate) {
    return (
      <Button variant="outline" size="xs" onClick={() => update.openUpdateFlow()}>
        Update
      </Button>
    );
  }

  return (
    <MicroLabel className="inline-flex h-6 items-center lowercase text-foreground-passive">
      v{update.currentVersion}
    </MicroLabel>
  );
});
