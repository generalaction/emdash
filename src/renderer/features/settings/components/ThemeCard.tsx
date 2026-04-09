import { Moon, Sun } from 'lucide-react';
import React from 'react';
import { useTheme } from '@renderer/lib/hooks/useTheme';

const ThemeCard: React.FC = () => {
  const { theme, setTheme } = useTheme();

  return (
    <div className="grid gap-3">
      <div>
        <div className="text-sm font-medium text-foreground">Color mode</div>
        <div className="text-sm text-muted-foreground">Choose how Emdash looks.</div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2">
        <button
          type="button"
          onClick={async () => {
            if (theme !== 'emlight') {
              void import('../../../utils/telemetryClient').then(({ captureTelemetry }) => {
                captureTelemetry('setting_changed', { setting: 'theme' });
              });
            }
            setTheme('emlight');
          }}
          className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border px-2 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:px-3 ${
            theme === 'emlight'
              ? 'border-primary bg-primary/10 text-foreground'
              : 'border-border/60 bg-background text-muted-foreground hover:border-border hover:bg-muted/40'
          }`}
          aria-pressed={theme === 'emlight'}
          aria-label="Set theme to Emdash Light"
        >
          <Sun className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="text-center leading-tight">Emdash Light</span>
        </button>
        <button
          type="button"
          disabled
          className="flex min-h-24 cursor-not-allowed flex-col items-center justify-center gap-2 rounded-lg border border-border/40 bg-background px-2 py-2.5 text-sm font-medium text-muted-foreground/50 opacity-60 sm:px-3"
          aria-label="Emdash Dark (coming soon)"
        >
          <Moon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="text-center leading-tight">
            Emdash Dark
            <br />
            <span className="text-xs">(coming soon)</span>
          </span>
        </button>
      </div>
    </div>
  );
};

export default ThemeCard;
