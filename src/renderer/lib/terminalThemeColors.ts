/**
 * Centralized terminal theme color constants.
 * Used by ChatInterface, MultiAgentTask, TaskTerminalPanel, and Monaco theme files.
 */

export const TERMINAL_SELECTION = {
  dark: {
    selectionBackground: 'rgba(96, 165, 250, 0.35)',
    selectionForeground: '#f9fafb',
  },
  light: {
    selectionBackground: 'rgba(59, 130, 246, 0.35)',
    selectionForeground: '#0f172a',
  },
} as const;

export const GREEN_COLORS = {
  background: '#2E5234',
  card: '#365A3C',
  foreground: '#dde6dd',
  lineHighlight: '#3D6343',
  lineNumber: '#7a9a7e',
  gutter: '#2E5234',
  unchangedRegion: '#264830',
} as const;

/** Per-theme base terminal backgrounds (non-agent-specific). */
export const TERMINAL_BACKGROUNDS = {
  light: '#ffffff',
  dark: '#1e1e1e',
  'dark-black': '#000000',
  green: GREEN_COLORS.background,
} as const;

/** Per-theme terminal backgrounds for the mistral agent. */
export const MISTRAL_BACKGROUNDS = {
  light: '#ffffff',
  dark: '#202938',
  'dark-black': '#141820',
  green: GREEN_COLORS.card,
} as const;

type EffectiveTheme = 'light' | 'dark' | 'dark-black' | 'green';

/**
 * Build the themeOverride object for a terminal pane.
 * Returns undefined when no override is needed (standard dark theme).
 */
export function getTerminalThemeOverride(
  effectiveTheme: EffectiveTheme,
  agent?: string
): Record<string, string> | undefined {
  const selection = effectiveTheme === 'light' ? TERMINAL_SELECTION.light : TERMINAL_SELECTION.dark;

  if (agent === 'charm') {
    return {
      background:
        effectiveTheme === 'dark-black'
          ? '#0a0a0a'
          : effectiveTheme === 'green'
            ? GREEN_COLORS.card
            : effectiveTheme === 'dark'
              ? '#1f2937'
              : '#ffffff',
      ...selection,
    };
  }

  if (agent === 'mistral') {
    return {
      background: MISTRAL_BACKGROUNDS[effectiveTheme],
      ...selection,
    };
  }

  // Non-agent-specific: only override for themes that differ from the dark default
  if (effectiveTheme === 'dark-black') {
    return { background: '#000000', ...selection };
  }
  if (effectiveTheme === 'green') {
    return { background: GREEN_COLORS.background, ...selection };
  }

  return undefined;
}

/**
 * Get the Tailwind bg class for the terminal container wrapper.
 */
export function getTerminalContainerClass(effectiveTheme: EffectiveTheme, agent?: string): string {
  if (agent === 'charm') {
    if (effectiveTheme === 'dark-black') return 'bg-black';
    if (effectiveTheme === 'green') return 'bg-card';
    if (effectiveTheme !== 'light') return 'bg-card';
    return 'bg-white';
  }

  if (agent === 'mistral') {
    if (effectiveTheme === 'dark-black') return 'bg-[#141820]';
    if (effectiveTheme === 'green') return 'bg-[#365A3C]';
    if (effectiveTheme !== 'light') return 'bg-[#202938]';
    return 'bg-white';
  }

  if (effectiveTheme !== 'light') return 'bg-card';
  return 'bg-white';
}
