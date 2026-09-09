import {
  COLOR_SCHEME_MANIFEST,
  DENSITY_MANIFEST,
  TYPOGRAPHY_MANIFEST,
} from '@emdash/theme/profiles';
import { SelectableCard } from '@emdash/ui/react/primitives';
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import React from 'react';
import type { Theme } from '@core/primitives/app-settings/api';
import { captureTelemetry } from '@core/primitives/telemetry/browser/telemetry-client';
import { useTheme } from '@core/primitives/theme/browser';

const colorSchemeOptions: Array<{
  value: Theme['colorScheme'];
  label: string;
  ariaLabel: string;
  icon: LucideIcon;
}> = [
  { value: null, label: 'System', ariaLabel: 'Set theme to system preference', icon: Monitor },
  ...COLOR_SCHEME_MANIFEST.map((profile) => ({
    value: profile.id,
    label: profile.label,
    ariaLabel: `Set Color scheme to ${profile.label}`,
    icon: profile.polarity === 'dark' ? Moon : Sun,
  })),
];

const ThemeCard: React.FC = () => {
  const { theme, setTheme } = useTheme();

  const handleSetTheme = (next: Theme) => {
    if (
      theme.colorScheme !== next.colorScheme ||
      theme.density !== next.density ||
      theme.typography !== next.typography
    ) {
      captureTelemetry('setting_changed', { setting: 'theme' });
    }
    setTheme(next);
  };

  return (
    <div className="flex flex-col gap-4 text-sm">
      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Color scheme</h3>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2">
          {colorSchemeOptions.map(({ value, label, ariaLabel, icon: Icon }) => (
            <SelectableCard
              key={label}
              selected={theme.colorScheme === value}
              onClick={() => handleSetTheme({ ...theme, colorScheme: value })}
              aria-label={ariaLabel}
              aria-pressed={theme.colorScheme === value}
              className="min-h-24"
            >
              <span className="flex flex-col items-center justify-center gap-2 px-2 py-2.5 text-sm font-medium sm:px-3">
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="text-center">{label}</span>
              </span>
            </SelectableCard>
          ))}
        </div>
      </section>
      <ProfileOptions
        label="Density"
        profiles={DENSITY_MANIFEST}
        selectedId={theme.density}
        onSelect={(density) => handleSetTheme({ ...theme, density })}
      />
      <ProfileOptions
        label="Typography"
        profiles={TYPOGRAPHY_MANIFEST}
        selectedId={theme.typography}
        onSelect={(typography) => handleSetTheme({ ...theme, typography })}
      />
    </div>
  );
};

function ProfileOptions<Id extends string>({
  label,
  profiles,
  selectedId,
  onSelect,
}: {
  label: string;
  profiles: readonly { readonly id: Id; readonly label: string }[];
  selectedId: Id;
  onSelect: (id: Id) => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium">{label}</h3>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2">
        {profiles.map((profile) => (
          <SelectableCard
            key={profile.id}
            selected={selectedId === profile.id}
            onClick={() => onSelect(profile.id)}
            aria-label={`Set ${label} to ${profile.label}`}
            aria-pressed={selectedId === profile.id}
          >
            <span className="flex items-center justify-center px-3 py-2.5 text-sm font-medium">
              {profile.label}
            </span>
          </SelectableCard>
        ))}
      </div>
    </section>
  );
}

export default ThemeCard;
