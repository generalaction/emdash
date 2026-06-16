export const MAX_STATUS_FILES = 10_000;

export class TooManyFilesChangedError extends Error {
  override readonly name = 'TooManyFilesChangedError';

  constructor() {
    super('Too many changed files');
  }
}

export type FileStatus = {
  x: string;
  y: string;
  rename?: string;
  path: string;
};

export class StatusParser {
  private lastRaw = '';
  private result: FileStatus[] = [];
  tooManyFiles = false;

  get status(): FileStatus[] {
    return this.result;
  }

  update(chunk: string): void {
    let raw = this.lastRaw + chunk;
    let index = 0;
    let nextIndex: number | undefined;

    while ((nextIndex = this.parseEntry(raw, index)) !== undefined) {
      index = nextIndex;
      if (this.result.length > MAX_STATUS_FILES) {
        this.tooManyFiles = true;
        raw = '';
        index = 0;
        break;
      }
    }

    this.lastRaw = raw.slice(index);
  }

  reset(): void {
    this.lastRaw = '';
    this.result = [];
    this.tooManyFiles = false;
  }

  private parseEntry(raw: string, index: number): number | undefined {
    if (index + 4 > raw.length) return undefined;

    const x = raw.charAt(index++);
    const y = raw.charAt(index++);
    index += 1;

    let rename: string | undefined;
    if (x === 'R' || y === 'R' || x === 'C') {
      const renameEnd = raw.indexOf('\0', index);
      if (renameEnd === -1) return undefined;
      rename = raw.substring(index, renameEnd);
      index = renameEnd + 1;
    }

    const pathEnd = raw.indexOf('\0', index);
    if (pathEnd === -1) return undefined;

    const filePath = raw.substring(index, pathEnd);
    if (filePath.length > 0 && filePath[filePath.length - 1] !== '/') {
      this.result.push({ x, y, rename, path: filePath });
    }

    return pathEnd + 1;
  }
}
