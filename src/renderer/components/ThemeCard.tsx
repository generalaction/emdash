import React from 'react';
import { useTheme } from '../hooks/useTheme';
import { Sun, Moon, Monitor, Zap } from 'lucide-react';

const ThemeCard: React.FC = () => {
  const { theme, setTheme } = useTheme();

  const options = [
    { value: 'light' as const, label: 'Light', icon: Sun },
    { value: 'dark' as const, label: 'Dark', icon: Moon },
    { value: 'lightsout' as const, label: 'Lights Out', icon: Zap },
    { value: 'system' as const, label: 'System', icon: Monitor },
  ];

  return (
    <div className="grid gap-3">
      <div>
        <div className="text-sm font-medium text-foreground">Appearance</div>
        <div className="text-xs text-muted-foreground">
          Choose how Emdash looks. System uses your operating system preference.
        </div>
      </div>
      <div className="flex gap-2">
        {options.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              theme === value
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border/60 bg-background text-muted-foreground hover:border-border hover:bg-muted/40'
            }`}
            aria-pressed={theme === value}
            aria-label={`Set theme to ${label}`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default ThemeCard;
