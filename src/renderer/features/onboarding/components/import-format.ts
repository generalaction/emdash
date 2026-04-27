import type { LegacyImportSource } from '@renderer/lib/hooks/useLegacyPort';

export function sourceLabel(source: LegacyImportSource): string {
  return source === 'v0' ? 'v0' : 'v1-beta';
}

export function formatCount(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}
