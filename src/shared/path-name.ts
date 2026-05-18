const WINDOWS_RESERVED_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function basenameFromAnyPath(input: string): string {
  const trimmed = input.trim().replace(/[\\/]+$/g, '');
  if (!trimmed) return '';
  return (
    trimmed
      .split(/[\\/]+/)
      .filter(Boolean)
      .pop() ?? ''
  );
}

export function dirnameFromAnyPath(input: string): string {
  const trimmed = input.replace(/[\\/]+$/, '');
  const separatorIndex = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (separatorIndex < 0) return '';
  return trimmed.slice(0, separatorIndex) || '/';
}

export function safePathSegment(input: string, fallback = 'project'): string {
  const segment = basenameFromAnyPath(input)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .trim();
  if (
    !segment ||
    segment === '.' ||
    segment === '..' ||
    WINDOWS_RESERVED_DEVICE_NAME.test(segment)
  ) {
    return fallback;
  }
  return segment;
}
