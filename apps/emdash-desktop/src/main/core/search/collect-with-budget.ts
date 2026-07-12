import type { FileIndexTruncateReason } from './workspace-file-index-store';

export type CollectWithBudgetOptions = {
  maxFiles: number;
  timeoutMs: number;
  now?: () => number;
  startTime?: number;
};

export type BudgetedFileCollection = {
  paths: string[];
  truncated: boolean;
  truncateReason?: FileIndexTruncateReason;
};

export async function collectWithBudget(
  paths: Iterable<string> | AsyncIterable<string>,
  options: CollectWithBudgetOptions
): Promise<BudgetedFileCollection> {
  const now = options.now ?? Date.now;
  const startTime = options.startTime ?? now();
  const collected: string[] = [];
  let truncated = false;
  let truncateReason: FileIndexTruncateReason | undefined;

  for await (const filePath of paths) {
    if (now() - startTime > options.timeoutMs) {
      truncated = true;
      truncateReason = 'timeBudget';
      break;
    }
    if (collected.length >= options.maxFiles) {
      truncated = true;
      truncateReason = 'maxEntries';
      break;
    }
    collected.push(filePath);
  }

  return { paths: collected, truncated, truncateReason };
}
