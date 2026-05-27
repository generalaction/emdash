export type DownloadProgress = {
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
};

export function normalizeDownloadProgress(progress: DownloadProgress): DownloadProgress {
  const transferred = progress.transferred ?? 0;
  const total = progress.total ?? 0;
  const derivedPercent = total > 0 ? (transferred / total) * 100 : undefined;
  const percent = progress.percent && progress.percent > 0 ? progress.percent : derivedPercent;

  return {
    ...progress,
    percent: clampPercent(percent ?? 0),
  };
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, percent));
}
