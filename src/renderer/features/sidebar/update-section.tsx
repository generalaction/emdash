import { observer } from 'mobx-react-lite';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { MicroLabel } from '@renderer/lib/ui/label';

export const UpdateSection = observer(function UpdateSection() {
  const update = appState.update;
  const { navigate } = useNavigate();

  if (update.hasUpdate) {
    return (
      <button
        type="button"
        onClick={() => navigate('settings')}
        className="group flex items-center"
      >
        <MicroLabel className="lowercase text-foreground-passive group-hover:text-foreground cursor-pointer flex items-center gap-1">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          {update.availableVersion ? `v${update.availableVersion}` : 'Update'}
        </MicroLabel>
      </button>
    );
  }

  return (
    <MicroLabel className="lowercase text-foreground-passive">v{update.currentVersion}</MicroLabel>
  );
});
