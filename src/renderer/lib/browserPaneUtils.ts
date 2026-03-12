/**
 * Returns true when the filename ends with .html or .htm (case-insensitive).
 */
export function isHtmlFile(name: string): boolean {
  return /\.html?$/i.test(name);
}

/**
 * Normalises a value entered into the browser-pane address bar.
 * - Preserves `http://`, `https://`, and `file://` URLs as-is.
 * - Prepends `http://` to everything else so bare hostnames work.
 */
export function normalizeAddressBarUrl(input: string): string {
  const trimmed = input.trim();
  if (/^(?:https?|file):\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

/**
 * Builds a `file://` URL from a root path and a relative file path.
 */
export function buildFileUrl(rootPath: string, relativePath: string): string {
  const joined = [rootPath, relativePath]
    .filter(Boolean)
    .join('/')
    .replace(/[\\/]+/g, '/');
  const absPath = joined.startsWith('/') ? joined : `/${joined}`;
  return `file://${absPath}`;
}
