export const EMDASH_CHANGELOG_URL = 'https://www.emdash.sh/changelog';
export const EMDASH_CHANGELOG_API_URL = 'https://www.emdash.sh/api/changelog';

export interface ChangelogEntry {
  version: string;
  title: string;
  summary: string;
  content: string;
  publishedAt?: string;
  url?: string;
  /** Hero/banner image URL shown at the top of the changelog modal */
  image?: string;
}

export function normalizeChangelogVersion(version: string | null | undefined): string | null {
  if (typeof version !== 'string') return null;
  const trimmed = version.trim().replace(/^v/i, '');
  if (!trimmed) return null;
  return /^[0-9]+(?:\.[0-9A-Za-z-]+){0,2}(?:[-+][0-9A-Za-z.-]+)?$/.test(trimmed) ? trimmed : null;
}

type ParsedVersion = {
  parts: number[];
  prerelease: string[];
};

function parseVersion(version: string): ParsedVersion {
  const [core, prerelease = ''] = version.split('-', 2);
  const parts = core.split('.').map((part) => {
    const value = Number.parseInt(part, 10);
    return Number.isFinite(value) ? value : 0;
  });

  while (parts.length < 3) {
    parts.push(0);
  }

  return {
    parts,
    prerelease: prerelease
      .split('.')
      .map((part) => part.trim())
      .filter(Boolean),
  };
}

function comparePrereleaseParts(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];

    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;

    const leftIsNumber = /^\d+$/.test(leftPart);
    const rightIsNumber = /^\d+$/.test(rightPart);

    if (leftIsNumber && rightIsNumber) {
      const delta = Number.parseInt(leftPart, 10) - Number.parseInt(rightPart, 10);
      if (delta !== 0) return delta > 0 ? 1 : -1;
      continue;
    }

    if (leftIsNumber) return -1;
    if (rightIsNumber) return 1;

    const comparison = leftPart.localeCompare(rightPart);
    if (comparison !== 0) return comparison > 0 ? 1 : -1;
  }

  return 0;
}

export function compareChangelogVersions(
  left: string | null | undefined,
  right: string | null | undefined
): number {
  const normalizedLeft = normalizeChangelogVersion(left);
  const normalizedRight = normalizeChangelogVersion(right);

  if (!normalizedLeft && !normalizedRight) return 0;
  if (!normalizedLeft) return -1;
  if (!normalizedRight) return 1;

  const parsedLeft = parseVersion(normalizedLeft);
  const parsedRight = parseVersion(normalizedRight);

  for (let index = 0; index < 3; index += 1) {
    const delta = parsedLeft.parts[index] - parsedRight.parts[index];
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }

  return comparePrereleaseParts(parsedLeft.prerelease, parsedRight.prerelease);
}
