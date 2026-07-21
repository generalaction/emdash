export function modelFeatureDotCount(score: number) {
  return Math.round(Math.max(0, Math.min(5, score)));
}
