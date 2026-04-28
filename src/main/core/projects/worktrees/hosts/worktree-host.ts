import type { FileEntry } from '@main/core/fs/types';

export interface WorktreeHost {
  existsAbsolute(path: string): Promise<boolean>;
  mkdirAbsolute(path: string, options?: { recursive?: boolean }): Promise<void>;
  removeAbsolute(
    path: string,
    options?: { recursive?: boolean }
  ): Promise<{ success: boolean; error?: string }>;
  realPathAbsolute(path: string): Promise<string>;
  globAbsolute(pattern: string, options: { cwd: string; dot?: boolean }): Promise<string[]>;
  copyFileAbsolute(src: string, dest: string): Promise<void>;
  statAbsolute(path: string): Promise<FileEntry | null>;
}
