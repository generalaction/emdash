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

export function safePathSegment(input: string, fallback = 'project'): string {
  const segment = basenameFromAnyPath(input)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .trim();
  if (!segment || segment === '.' || segment === '..') return fallback;
  return segment;
}
