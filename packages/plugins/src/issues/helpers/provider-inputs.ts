import type { IssueError } from '../types';

export function clampIssueLimit(limit: number | undefined, fallback: number, max: number): number {
  const resolved = Number.isFinite(limit) ? (limit as number) : fallback;
  return Math.max(1, Math.min(resolved, max));
}

export function normalizeSearchTerm(searchTerm: string): string {
  return String(searchTerm || '').trim();
}

export function issueError<TType extends IssueError['type']>(type: TType, message: string) {
  return { type, message };
}
