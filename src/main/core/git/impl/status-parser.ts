/**
 * Incremental NUL-delimited parser for `git status -z` output (porcelain v1, z mode).
 * Matches the structure of VSCode's GitStatusParser.
 */

/** Max entries before we signal `tooManyFiles` and callers should kill `git status`. */
export const MAX_STATUS_FILES = 10_000;

export class TooManyFilesChangedError extends Error {
  override readonly name = 'TooManyFilesChangedError';
  constructor() {
    super('Too many changed files');
  }
}

export interface IFileStatus {
  x: string;
  y: string;
  /** For rename/copy — the path before rename (second segment). */
  rename?: string;
  path: string;
}

export class StatusParser {
  private lastRaw = '';
  private result: IFileStatus[] = [];
  tooManyFiles = false;

  get status(): IFileStatus[] {
    return this.result;
  }

  /**
   * Feed raw string chunks from `git status -z` stdout. Incomplete tail bytes are buffered.
   */
  update(chunk: string): void {
    let raw = this.lastRaw + chunk;
    let i = 0;
    let nextI: number | undefined;

    while ((nextI = this.parseEntry(raw, i)) !== undefined) {
      i = nextI;
      if (this.result.length > MAX_STATUS_FILES) {
        this.tooManyFiles = true;
        raw = '';
        i = 0;
        break;
      }
    }

    this.lastRaw = raw.slice(i);
  }

  /**
   * Parse one complete entry starting at `i`. Returns index after the entry, or `undefined` if truncated.
   */
  private parseEntry(raw: string, i: number): number | undefined {
    if (i + 4 > raw.length) {
      return undefined;
    }

    const x = raw.charAt(i++);
    const y = raw.charAt(i++);
    // Space after XY
    i++;

    let rename: string | undefined;

    if (x === 'R' || y === 'R' || x === 'C') {
      const renameEnd = raw.indexOf('\0', i);
      if (renameEnd === -1) {
        return undefined;
      }
      rename = raw.substring(i, renameEnd);
      i = renameEnd + 1;
    }

    const pathEnd = raw.indexOf('\0', i);
    if (pathEnd === -1) {
      return undefined;
    }

    const path = raw.substring(i, pathEnd);
    // Nested git repo directory entries end with /
    if (path.length > 0 && path[path.length - 1] !== '/') {
      this.result.push({ x, y, rename, path });
    }

    return pathEnd + 1;
  }

  reset(): void {
    this.lastRaw = '';
    this.result = [];
    this.tooManyFiles = false;
  }
}
