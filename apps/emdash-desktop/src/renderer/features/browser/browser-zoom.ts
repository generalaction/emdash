export const BROWSER_ZOOM_FACTORS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5,
] as const;

export const BROWSER_DEFAULT_ZOOM_FACTOR = 1;

const ZOOM_EPSILON = 0.001;

export function normalizeBrowserZoomFactor(factor: number | undefined): number {
  if (factor === undefined || !Number.isFinite(factor)) return BROWSER_DEFAULT_ZOOM_FACTOR;
  const min = BROWSER_ZOOM_FACTORS[0];
  const max = BROWSER_ZOOM_FACTORS[BROWSER_ZOOM_FACTORS.length - 1];
  return Math.min(max, Math.max(min, factor));
}

export function nextBrowserZoomFactor(factor: number | undefined): number {
  const current = normalizeBrowserZoomFactor(factor);
  for (const step of BROWSER_ZOOM_FACTORS) {
    if (step > current + ZOOM_EPSILON) return step;
  }
  return BROWSER_ZOOM_FACTORS[BROWSER_ZOOM_FACTORS.length - 1];
}

export function previousBrowserZoomFactor(factor: number | undefined): number {
  const current = normalizeBrowserZoomFactor(factor);
  for (let i = BROWSER_ZOOM_FACTORS.length - 1; i >= 0; i--) {
    if (BROWSER_ZOOM_FACTORS[i] < current - ZOOM_EPSILON) return BROWSER_ZOOM_FACTORS[i];
  }
  return BROWSER_ZOOM_FACTORS[0];
}

export function canZoomIn(factor: number | undefined): boolean {
  return (
    normalizeBrowserZoomFactor(factor) <
    BROWSER_ZOOM_FACTORS[BROWSER_ZOOM_FACTORS.length - 1] - ZOOM_EPSILON
  );
}

export function canZoomOut(factor: number | undefined): boolean {
  return normalizeBrowserZoomFactor(factor) > BROWSER_ZOOM_FACTORS[0] + ZOOM_EPSILON;
}

export function isDefaultBrowserZoomFactor(factor: number | undefined): boolean {
  return Math.abs(normalizeBrowserZoomFactor(factor) - BROWSER_DEFAULT_ZOOM_FACTOR) < ZOOM_EPSILON;
}

export function formatBrowserZoomPercent(factor: number | undefined): string {
  return `${Math.round(normalizeBrowserZoomFactor(factor) * 100)}%`;
}
