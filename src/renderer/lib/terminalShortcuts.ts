export function isTerminalExpandShortcut(event: KeyboardEvent): boolean {
  // Cmd+Shift+T on macOS (metaKey) or Ctrl+Shift+T on other platforms
  if (!event.shiftKey) return false;
  if (!event.metaKey && !event.ctrlKey) return false;

  const key = event.key;
  return key === 't' || key === 'T';
}
