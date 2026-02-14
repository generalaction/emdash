/**
 * File index manager for Quick Open
 * Builds and searches an in-memory index of repository files
 */

import { fuzzyMatchPath } from './fuzzyMatch';
import type { FileIndexEntry, SearchResult } from './types';

export class FileIndexManager {
  private index: FileIndexEntry[] = [];
  private rootPath: string | null = null;

  /**
   * Build the file index from fsList items
   * Only indexes files (not directories) for faster search
   */
  buildIndex(items: Array<{ path: string; type: 'file' | 'dir' }>): void {
    this.index = items
      .filter((it) => it.type === 'file') // Only index files
      .map((it) => ({
        path: it.path,
        fileName: it.path.split('/').pop() || '',
        segments: it.path.split('/'),
        type: it.type,
      }));
  }

  /**
   * Search the index with fuzzy matching
   * Returns top N results sorted by score
   */
  search(query: string, limit = 50): SearchResult[] {
    if (!query) {
      return [];
    }

    const results: SearchResult[] = [];

    for (const entry of this.index) {
      const match = fuzzyMatchPath(query, entry.path);

      if (match.matches) {
        results.push({
          entry,
          score: match.score,
          highlights: match.highlights,
        });
      }
    }

    // Sort by score (descending), then path length (ascending)
    results.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.entry.path.length - b.entry.path.length;
    });

    return results.slice(0, limit);
  }

  /**
   * Parse query for file:line syntax
   * e.g., "index.ts:120" → { path: "index.ts", line: 120 }
   */
  parseQuery(query: string): { path: string; line?: number } {
    const match = query.match(/^(.+):(\d+)$/);
    if (match) {
      return {
        path: match[1],
        line: parseInt(match[2], 10),
      };
    }
    return { path: query };
  }

  /**
   * Get the number of indexed files
   */
  get size(): number {
    return this.index.length;
  }

  /**
   * Clear the index
   */
  invalidate(): void {
    this.index = [];
    this.rootPath = null;
  }

  /**
   * Set the root path (for reference)
   */
  setRootPath(path: string): void {
    this.rootPath = path;
  }

  /**
   * Get the root path
   */
  getRootPath(): string | null {
    return this.rootPath;
  }
}
