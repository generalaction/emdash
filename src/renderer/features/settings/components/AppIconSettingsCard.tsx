import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import betaIcon from '@/assets/images/emdash/app-icon-beta-rounded.png';
import canaryIcon from '@/assets/images/emdash/app-icon-canary-blue.png';
import defaultIcon from '@/assets/images/emdash/icon-dock.png';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { rpc } from '@renderer/lib/ipc';
import { cn } from '@renderer/utils/utils';
import { APP_ICON_LABELS, type AppIconId } from '@shared/app-icons';

const iconOptions: Array<{ id: AppIconId; image: string; description: string }> = [
  { id: 'default', image: defaultIcon, description: 'The standard Emdash icon.' },
  { id: 'beta', image: betaIcon, description: 'The Beta app icon.' },
  { id: 'canary', image: canaryIcon, description: 'The Canary app icon.' },
];

export default function AppIconSettingsCard() {
  const { data: platform } = useQuery({
    queryKey: ['app', 'platform'],
    queryFn: () => rpc.app.getPlatform(),
  });
  const { value, update, isLoading, isSaving } = useAppSettingsKey('appIcon');
  const selectedIcon = value?.icon ?? 'default';
  const disabled = isLoading || isSaving;

  if (platform !== 'darwin') {
    return (
      <div className="rounded-xl border border-border/60 bg-background p-4 text-sm text-foreground-muted">
        App icon switching is currently available on macOS only.
      </div>
    );
  }

  return (
    <div className="grid gap-3 text-sm">
      <div>
        <div className="font-medium text-foreground">App icon</div>
        <div className="text-foreground-muted">Choose the icon Emdash uses in the Dock.</div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-3">
        {iconOptions.map((option) => {
          const isSelected = option.id === selectedIcon;

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => update({ icon: option.id })}
              disabled={disabled}
              aria-pressed={isSelected}
              className={cn(
                'relative flex min-h-36 flex-col items-center justify-center gap-3 rounded-xl border px-4 py-4 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
                isSelected
                  ? 'border-border bg-background-2 text-foreground'
                  : 'border-border/60 bg-background text-foreground-muted hover:bg-background-1 hover:text-foreground'
              )}
            >
              {isSelected && (
                <span className="absolute top-3 right-3 rounded-full bg-foreground p-1 text-background">
                  <Check className="size-3" />
                </span>
              )}
              <img
                src={option.image}
                alt=""
                className="size-20 rounded-2xl shadow-sm"
                draggable={false}
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium text-foreground">{APP_ICON_LABELS[option.id]}</span>
                <span className="text-xs text-foreground-muted">{option.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
