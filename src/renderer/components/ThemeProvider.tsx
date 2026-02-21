import { createContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark' | 'dark-black' | 'system';
type EffectiveTheme = 'light' | 'dark' | 'dark-black';

const STORAGE_KEY = 'emdash-theme';

function getSystemTheme(): EffectiveTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark-black' : 'light';
}

function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'dark-black' || stored === 'system') {
      return stored;
    }
  } catch {}
  return 'system';
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  const effectiveTheme = theme === 'system' ? getSystemTheme() : theme;

  // Remove all theme classes first
  root.classList.remove('dark', 'dark-black');

  // Apply the appropriate theme class
  if (effectiveTheme === 'dark') {
    root.classList.add('dark');
  } else if (effectiveTheme === 'dark-black') {
    root.classList.add('dark', 'dark-black');
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
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme());
  const [systemTheme, setSystemTheme] = useState<EffectiveTheme>(() => getSystemTheme());

  const effectiveTheme: EffectiveTheme =
    theme === 'system' ? systemTheme : (theme as EffectiveTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme, systemTheme]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Ignore localStorage errors
    }
  }, [theme]);

  // Load theme from backend settings on mount and handle migration
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const result = await window.electronAPI.getSettings();
        if (!result.success) return;

        const backendTheme = result.settings?.interface?.theme;

        if (backendTheme !== undefined) {
          setThemeState(backendTheme);
        } else {
          // Migrate localStorage theme to backend settings
          const localTheme = getStoredTheme();
          if (localTheme !== 'system') {
            await window.electronAPI.updateSettings({
              interface: { theme: localTheme },
            });
          }
          setThemeState(localTheme);
        }
      } catch (error) {
        console.error('Failed to load theme settings:', error);
      }
    };

    loadSettings();
  }, []);

  // Listen for system theme changes
  useEffect(() => {
    if (theme !== 'system') return undefined;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      setSystemTheme(getSystemTheme());
    };

    // Modern browsers
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    }

    // Legacy browsers
    mediaQuery.addListener(handler);
    return () => mediaQuery.removeListener(handler);
  }, [theme]);

  const updateTheme = async (newTheme: Theme) => {
    setThemeState(newTheme);
    try {
      await window.electronAPI.updateSettings({
        interface: { theme: newTheme },
      });
    } catch (error) {
      console.error('Failed to save theme setting:', error);
    }
  };

  const toggleTheme = () => {
    let newTheme: Theme = 'light';

    // Cycle through: light -> dark -> dark-black -> light
    if (theme === 'light') newTheme = 'dark';
    else if (theme === 'dark') newTheme = 'dark-black';
    else if (theme === 'dark-black') newTheme = 'light';
    else if (theme === 'system') {
      // If system, start cycling from the effective theme
      if (effectiveTheme === 'light') newTheme = 'dark';
      else if (effectiveTheme === 'dark') newTheme = 'dark-black';
      else newTheme = 'light';
    }

    updateTheme(newTheme);
  };

  const setTheme = (newTheme: Theme) => {
    updateTheme(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, effectiveTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
