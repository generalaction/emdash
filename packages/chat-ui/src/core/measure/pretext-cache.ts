/**
 * Thin helpers around pretext's `prepareRichInline`.
 *
 * The per-instance richInlineCache has moved to ChatCaches (core/caches.ts).
 * This module now exports:
 *   registerFontsReadyClear  — font-load hook; calls onCleared which should
 *                              invoke caches.clearTextMeasure() + remeasure.
 *   clearPretextInternalCaches — flush pretext's internal global caches (re-exported
 *                               for use from ChatCaches.clearTextMeasure).
 */

export { clearCache as clearPretextInternalCaches } from '@chenglou/pretext';

/**
 * Named webfont faces to pre-load. The default monospace stack uses system
 * fonts, which are immediately available and do not need an async load.
 */
const FONT_LOAD_SPECS = ['400 14px "Inter Variable"', '600 14px "Inter Variable"'];

/**
 * Eagerly load the bundled named webfonts, then call `onCleared`
 * (which should invoke `caches.clearTextMeasure()` + `virtualizer.measure()`).
 *
 * Using `document.fonts.load(spec)` instead of `document.fonts.ready` ensures
 * we wait for the exact faces pretext needs, not just "all fonts document-wide".
 * Without this, pretext measures with the fallback metrics during first paint
 * and produces wrong line-break positions until the cache is cleared.
 *
 * Call this once when ChatTranscript mounts.
 */
export function registerFontsReadyClear(onCleared?: () => void): void {
  if (typeof document === 'undefined') return;
  void Promise.all(FONT_LOAD_SPECS.map((spec) => document.fonts.load(spec))).then(() => {
    onCleared?.();
  });
}
