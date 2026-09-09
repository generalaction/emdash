import {
  xtermThemeIntegration,
  type XtermThemeIntegrationValues,
} from '@core/features/terminals/browser/pty/xterm-theme-integration';

const TEST_XTERM_THEME = {
  background: '#101010',
  foreground: '#f0f0f0',
  cursor: '#f0f0f0',
  cursorAccent: '#101010',
  selectionBackground: '#335577',
  selectionForeground: '#ffffff',
} satisfies XtermThemeIntegrationValues;

/** Installs a complete Xterm Theme through the generated manifest properties. */
export function setXtermThemeFixture(): void {
  for (const field of Object.keys(TEST_XTERM_THEME) as (keyof XtermThemeIntegrationValues)[]) {
    document.documentElement.style.setProperty(
      xtermThemeIntegration.properties[field],
      TEST_XTERM_THEME[field]
    );
  }
}
