import { use } from 'react';
import { ThemeContext } from '../providers/theme-provider';

export function useTheme() {
  const context = use(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
