const CLAUDE_THEME_SETTINGS = JSON.stringify({ theme: 'auto' });

export function getClaudeThemeSettingsArgs(): string[] {
  return ['--settings', CLAUDE_THEME_SETTINGS];
}
