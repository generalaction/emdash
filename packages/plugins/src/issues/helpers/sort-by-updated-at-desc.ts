import type { IssueData } from '../types';

export function sortByUpdatedAtDesc(issues: IssueData[]): IssueData[] {
  return [...issues].sort(
    (a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
  );
}
