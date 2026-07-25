/** Cycles an index forward/backward through a list of the given length, wrapping at both ends. */
export function getNextCycleIndex(
  length: number,
  currentIndex: number,
  direction: 'next' | 'prev'
): number {
  if (length === 0) return -1;

  if (currentIndex < 0 || currentIndex >= length) {
    return direction === 'prev' ? length - 1 : 0;
  }

  if (direction === 'prev') {
    return currentIndex === 0 ? length - 1 : currentIndex - 1;
  }

  return currentIndex === length - 1 ? 0 : currentIndex + 1;
}
