const SINGLE_PREFIX_TUI_SLASH_RE = /^[a-z]\/[a-z][\w-]{2,}$/i;

/**
 * Detects slash-command style input across CLIs/TUIs.
 *
 * Rules:
 * - `/...` is always treated as a slash command.
 * - Some TUIs may leave a one-char mode prefix before slash commands
 *   (example: `i/model`). Treat those as slash commands too.
 */
export function isSlashCommandInput(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('/')) return true;
  if (/\s/.test(trimmed)) return false;
  return SINGLE_PREFIX_TUI_SLASH_RE.test(trimmed);
}
