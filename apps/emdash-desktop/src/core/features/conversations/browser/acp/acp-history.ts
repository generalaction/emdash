export function seedNonEmptyHistory<T>(turns: T[], seed: (turns: T[]) => void): boolean {
  if (turns.length === 0) return false;
  seed(turns);
  return true;
}
