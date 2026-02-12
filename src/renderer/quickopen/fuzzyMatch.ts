/**
 * Lightweight fuzzy matching for file paths
 * No dependencies, ~80 lines
 */

import type { FuzzyMatchResult } from './types';

/**
 * Fuzzy match a query against a target string
 * Returns match status, score (higher is better), and highlight indices
 *
 * Scoring rules:
 * - Start of string match: +100
 * - Consecutive character matches: +10 per additional char
 * - Camel case match (e.g., "FC" → "FileComponent"): +50
 * - Shorter paths score higher: -0.1 per char in target
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatchResult {
  if (!query) {
    return { matches: true, score: 0, highlights: [] };
  }

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  let qi = 0;
  let ti = 0;
  const highlights: number[] = [];
  let score = 0;
  let consecutive = 0;

  // Try to match all query characters
  while (qi < q.length && ti < t.length) {
    if (q[qi] === t[ti]) {
      highlights.push(ti);
      consecutive++;
      score += 10 + consecutive * 2; // Bonus for consecutive matches
      qi++;
    } else {
      consecutive = 0;
    }
    ti++;
  }

  // If we didn't match all query characters, no match
  if (qi < q.length) {
    return { matches: false, score: 0, highlights: [] };
  }

  // Bonuses
  if (highlights[0] === 0) {
    score += 100; // Starts with query
  }

  // Check for camel case match
  if (isCamelCaseMatch(query, target, highlights)) {
    score += 50;
  }

  // Shorter paths win (subtract small penalty for length)
  score -= target.length * 0.1;

  return { matches: true, score, highlights };
}

/**
 * Check if the match is a camel case match
 * e.g., "FC" matching "FileComponent" at positions [0, 4]
 */
function isCamelCaseMatch(query: string, target: string, highlights: number[]): boolean {
  if (highlights.length === 0) return false;

  let camelCount = 0;
  for (const idx of highlights) {
    // Check if this position is uppercase in original target
    if (idx > 0 && target[idx] === target[idx].toUpperCase() && target[idx] !== target[idx].toLowerCase()) {
      camelCount++;
    }
  }

  // If more than half the matches are on camel case boundaries, boost score
  return camelCount >= Math.ceil(highlights.length / 2);
}

/**
 * Match query against filename first, then full path if no match
 * Returns best match result
 */
export function fuzzyMatchPath(query: string, filePath: string): FuzzyMatchResult {
  const fileName = filePath.split('/').pop() || '';

  // Try matching against filename first (more relevant)
  const fileNameMatch = fuzzyMatch(query, fileName);
  if (fileNameMatch.matches) {
    // Boost filename matches
    return {
      ...fileNameMatch,
      score: fileNameMatch.score + 200,
    };
  }

  // Fall back to full path
  return fuzzyMatch(query, filePath);
}
