import type {
  FileEntry,
  FileListResult,
  FileSystemProvider,
  ReadResult,
  SearchResult,
  WriteResult,
} from '../types';

export class MemoryFs implements FileSystemProvider {
  readonly files = new Map<string, string>();

  async list(): Promise<FileListResult> {
    return {
      entries: Array.from(this.files.keys()).map((path) => ({ path, type: 'file' as const })),
      total: this.files.size,
    };
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async read(path: string): Promise<ReadResult> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`not found: ${path}`);
    }
    return {
      content,
      truncated: false,
      totalSize: Buffer.byteLength(content),
    };
  }

  async write(path: string, content: string): Promise<WriteResult> {
    this.files.set(path, content);
    return {
      success: true,
      bytesWritten: Buffer.byteLength(content),
    };
  }

  async stat(path: string): Promise<FileEntry | null> {
    const content = this.files.get(path);
    if (content === undefined) return null;
    return {
      path,
      type: 'file',
      size: Buffer.byteLength(content),
    };
  }

  async search(): Promise<SearchResult> {
    return {
      matches: [],
      total: 0,
    };
  }

  async remove(path: string): Promise<{ success: boolean; error?: string }> {
    this.files.delete(path);
    return { success: true };
  }

  async realPath(path: string): Promise<string> {
    return path;
  }

  async glob(): Promise<string[]> {
    return Array.from(this.files.keys());
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const content = this.files.get(src);
    if (content === undefined) throw new Error(`not found: ${src}`);
    this.files.set(dest, content);
  }

  async mkdir(): Promise<void> {}

  watch(): { update(paths: string[]): void; close(): void } {
    return {
      update: () => {},
      close: () => {},
    };
  }
}
