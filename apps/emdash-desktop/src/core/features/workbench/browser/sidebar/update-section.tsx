import { observer } from 'mobx-react-lite';
import { settingsViewDef } from '@core/features/settings/contributions/views';
import { Button } from '@core/primitives/ui/browser/button';
import { MicroLabel } from '@core/primitives/ui/browser/label';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { appState } from '@renderer/lib/stores/app-state';

export const UpdateSection = observer(function UpdateSection() {
  const update = appState.update;
  const { navigate } = useNavigate();

  if (update.hasUpdate) {
    return (
      <Button
        variant="outline"
        size="xs"
        onClick={() => {
          navigate(settingsViewDef({ tab: 'general' }));
          if (update.state.status === 'available') {
            void update.download();
          }
        }}
      >
        Update
      </Button>
    );
  }

  return (
    <MicroLabel className="inline-flex h-6 items-center text-foreground-passive lowercase">
      v{update.currentVersion}
    </MicroLabel>
  );
});
