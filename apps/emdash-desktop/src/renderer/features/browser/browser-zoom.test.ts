import { describe, expect, it } from 'vitest';
import {
  BROWSER_DEFAULT_ZOOM_FACTOR,
  BROWSER_ZOOM_FACTORS,
  canZoomIn,
  canZoomOut,
  formatBrowserZoomPercent,
  isDefaultBrowserZoomFactor,
  nextBrowserZoomFactor,
  normalizeBrowserZoomFactor,
  previousBrowserZoomFactor,
} from './browser-zoom';

const MIN_ZOOM = BROWSER_ZOOM_FACTORS[0];
const MAX_ZOOM = BROWSER_ZOOM_FACTORS[BROWSER_ZOOM_FACTORS.length - 1];

describe('browser zoom', () => {
  it('normalizes missing and invalid factors to the default', () => {
    expect(normalizeBrowserZoomFactor(undefined)).toBe(BROWSER_DEFAULT_ZOOM_FACTOR);
    expect(normalizeBrowserZoomFactor(Number.NaN)).toBe(BROWSER_DEFAULT_ZOOM_FACTOR);
    expect(normalizeBrowserZoomFactor(Number.POSITIVE_INFINITY)).toBe(BROWSER_DEFAULT_ZOOM_FACTOR);
  });

  it('clamps factors to the supported range', () => {
    expect(normalizeBrowserZoomFactor(0.01)).toBe(MIN_ZOOM);
    expect(normalizeBrowserZoomFactor(50)).toBe(MAX_ZOOM);
    expect(normalizeBrowserZoomFactor(1.5)).toBe(1.5);
  });

  it('steps to the next and previous preset factor', () => {
    expect(nextBrowserZoomFactor(1)).toBe(1.1);
    expect(previousBrowserZoomFactor(1)).toBe(0.9);
    expect(nextBrowserZoomFactor(undefined)).toBe(1.1);
    expect(previousBrowserZoomFactor(undefined)).toBe(0.9);
  });

  it('snaps off-preset factors to the nearest preset in the step direction', () => {
    expect(nextBrowserZoomFactor(1.05)).toBe(1.1);
    expect(previousBrowserZoomFactor(1.05)).toBe(1);
  });

  it('saturates at the range boundaries', () => {
    expect(nextBrowserZoomFactor(MAX_ZOOM)).toBe(MAX_ZOOM);
    expect(previousBrowserZoomFactor(MIN_ZOOM)).toBe(MIN_ZOOM);
    expect(canZoomIn(MAX_ZOOM)).toBe(false);
    expect(canZoomOut(MIN_ZOOM)).toBe(false);
    expect(canZoomIn(1)).toBe(true);
    expect(canZoomOut(1)).toBe(true);
  });

  it('detects the default factor', () => {
    expect(isDefaultBrowserZoomFactor(undefined)).toBe(true);
    expect(isDefaultBrowserZoomFactor(1)).toBe(true);
    expect(isDefaultBrowserZoomFactor(1.25)).toBe(false);
  });

  it('formats factors as rounded percentages', () => {
    expect(formatBrowserZoomPercent(undefined)).toBe('100%');
    expect(formatBrowserZoomPercent(0.33)).toBe('33%');
    expect(formatBrowserZoomPercent(2.5)).toBe('250%');
  });
});
