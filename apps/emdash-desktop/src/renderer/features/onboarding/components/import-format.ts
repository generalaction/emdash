import type { LegacyImportSource } from '@shared/legacy-port';

export function sourceLabel(source: LegacyImportSource): string {
  return source === 'v0' ? 'v0' : 'v1-beta';
}

export function formatCount(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}
