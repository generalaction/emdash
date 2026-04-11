export function clampIssueLimit(limit: number | undefined, fallback: number, max: number): number {
  const resolved = Number.isFinite(limit) ? (limit as number) : fallback;
  return Math.max(1, Math.min(resolved, max));
}

export function requireProjectPath(projectPath?: string): string | null {
  const trimmed = projectPath?.trim();
  return trimmed ? trimmed : null;
}

export function requireNameWithOwner(nameWithOwner?: string): string | null {
  const trimmed = nameWithOwner?.trim();
  return trimmed ? trimmed : null;
}

export function normalizeSearchTerm(searchTerm: string): string {
  return String(searchTerm || '').trim();
}
