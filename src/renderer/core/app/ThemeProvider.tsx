import { createContext, useEffect, type ReactNode } from 'react';
import { useAppSettingsKey } from '@renderer/core/app/use-app-settings-key';
import { applyThemeToAll } from '@renderer/core/pty/pty';
import { useLocalStorage } from '@renderer/hooks/useLocalStorage';

type Theme = 'emlight' | 'emdark';
type EffectiveTheme = 'emlight' | 'emdark';

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  root.classList.remove('dark', 'dark-black', 'emlight', 'emdark');

  if (theme === 'emlight') {
    root.classList.add('emlight');
  }
}

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  effectiveTheme: EffectiveTheme;
}

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { value: themeValue, isLoading, update } = useAppSettingsKey('theme');
  const [, setCachedTheme] = useLocalStorage<Theme>('emdash-theme', 'emlight');

  const theme: Theme = themeValue ?? 'emlight';
  const effectiveTheme: EffectiveTheme = theme;

  useEffect(() => {
    // Don't touch DOM classes or overwrite the localStorage cache until the real
    // setting has loaded — the inline <script> in index.html already applied the
    // correct classes from the cached value and we must not stomp them with the
    // 'emlight' fallback that's used while the IPC call is in-flight.
    if (isLoading) return;
    applyTheme(theme);
    setCachedTheme(theme);
  }, [theme, isLoading, setCachedTheme]);

  // Re-apply xterm theme after CSS classes have been updated by the effect above.
  useEffect(() => {
    applyThemeToAll();
  }, [effectiveTheme]);

  const setTheme = (newTheme: Theme) => {
    update(newTheme);
  };

  const toggleTheme = () => {
    setTheme(theme === 'emlight' ? 'emdark' : 'emlight');
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, effectiveTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
