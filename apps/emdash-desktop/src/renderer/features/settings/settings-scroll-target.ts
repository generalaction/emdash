export function getSettingsTargetSelector(target: string): string {
  const escapedTarget = typeof CSS !== 'undefined' && 'escape' in CSS ? CSS.escape(target) : target;
  return `[data-setting-id="${escapedTarget}"]`;
}

export function scrollSettingTargetIntoView(target: string): boolean {
  const element = document.querySelector<HTMLElement>(getSettingsTargetSelector(target));
  if (!element) return false;

  element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return true;
}
