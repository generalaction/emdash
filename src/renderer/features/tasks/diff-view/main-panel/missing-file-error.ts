export function isMissingFileError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /\b(ENOENT|File not found)\b/i.test(message);
}
