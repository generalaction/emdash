import type { LegacyImportSource, LegacyPortPreview } from '@shared/legacy-port';

export type ImportStepPreview = LegacyPortPreview;

export function availableSources(preview: ImportStepPreview | undefined): LegacyImportSource[] {
  const sources: LegacyImportSource[] = [];
  if (preview?.sources.v0.available) sources.push('v0');
  if (preview?.sources.v1Beta.available) sources.push('v1-beta');
  return sources;
}

export function shouldShowSourceSelector(preview: ImportStepPreview | undefined): boolean {
  return availableSources(preview).length > 1;
}

export function singleAvailableSource(
  preview: ImportStepPreview | undefined
): LegacyImportSource | null {
  const sources = availableSources(preview);
  return sources.length === 1 ? sources[0] : null;
}

export function shouldCenterImportContent(preview: ImportStepPreview | undefined): boolean {
  return singleAvailableSource(preview) !== null;
}
