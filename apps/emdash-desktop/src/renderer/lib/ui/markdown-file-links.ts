/**
 * Heuristic for inline code spans that name a workspace file, so chat
 * surfaces can make them clickable. Matches single tokens with a file
 * extension ("package.json", "src/a/b.tsx", "src-tauri/Cargo.toml"),
 * optionally with a trailing :line[:col]. Commands, globs, and prose stay
 * plain.
 */
const FILE_PATH_CODE_PATTERN =
  /^(?:\.{1,2}\/)?[\w@~+=-][\w.@~+=-]*(?:\/[\w.@~+=-]+)*\.[A-Za-z0-9]{1,8}(?::\d+(?::\d+)?)?$/;

/**
 * Returns the openable path (line/column suffix stripped) when an inline code
 * span looks like a file reference, or null when it should stay plain code.
 */
export function extractFilePathFromInlineCode(code: string): string | null {
  const trimmed = code.trim();
  if (!trimmed || trimmed.length > 256) return null;
  if (/[\s*?<>|"']/.test(trimmed)) return null;
  // Version numbers ("0.0.1") match the shape of a file name; require a letter.
  if (!/[A-Za-z]/.test(trimmed)) return null;
  if (!FILE_PATH_CODE_PATTERN.test(trimmed)) return null;
  return trimmed.replace(/:\d+(?::\d+)?$/, '');
}
