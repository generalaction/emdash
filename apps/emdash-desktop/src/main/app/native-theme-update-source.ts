let pendingSettingsThemeUpdates = 0;

export function markNextNativeThemeUpdateFromSettings(): void {
  pendingSettingsThemeUpdates += 1;

  setTimeout(() => {
    pendingSettingsThemeUpdates = Math.max(0, pendingSettingsThemeUpdates - 1);
  }, 0);
}

export function consumeNativeThemeUpdateFromSettings(): boolean {
  if (pendingSettingsThemeUpdates === 0) return false;
  pendingSettingsThemeUpdates -= 1;
  return true;
}
