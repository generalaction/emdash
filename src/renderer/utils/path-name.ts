/**
 * Cross-platform path utilities for the renderer.
 *
 * The renderer receives paths from the main process which may have been
 * normalized either way depending on origin (git output uses `/`; Windows file
 * dialogs return `\`). Splitting only on `/` (the historical pattern in this
 * codebase) silently produces wrong results for the latter case.
 *
 * These helpers split on **both** separators, so they always extract the
 * trailing component regardless of how the path was constructed upstream.
 */

const SEP_PATTERN = /[/\\]/;

/** Trailing path component, splitting on `/` and `\`. */
export function basenameAny(p: string): string {
  if (!p) return '';
  // Strip a single trailing separator so `foo/` returns `foo`.
  const trimmed = p.endsWith('/') || p.endsWith('\\') ? p.slice(0, -1) : p;
  const segments = trimmed.split(SEP_PATTERN);
  return segments[segments.length - 1] ?? '';
}

/** Directory portion of a path. Returns `''` if no separator is present. */
export function dirnameAny(p: string): string {
  if (!p) return '';
  const trimmed = p.endsWith('/') || p.endsWith('\\') ? p.slice(0, -1) : p;
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (idx === -1) return '';
  return trimmed.slice(0, idx);
}

/** File extension including the leading dot, or `''` if none. */
export function extnameAny(p: string): string {
  const base = basenameAny(p);
  const idx = base.lastIndexOf('.');
  if (idx <= 0) return '';
  return base.slice(idx);
}
