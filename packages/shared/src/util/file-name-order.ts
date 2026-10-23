const fileNameCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/**
 * The single file-name order shared by tree producers and renderers: natural
 * (numeric-aware), case-insensitive collation, with a code-unit tiebreak so names
 * that collate as equal (`a` and `A`) still order deterministically. Callers that
 * list directories first apply that rank before comparing names.
 */
export function compareFileNames(left: string, right: string): number {
  const collated = fileNameCollator.compare(left, right);
  if (collated !== 0) return collated;
  return left < right ? -1 : left > right ? 1 : 0;
}
