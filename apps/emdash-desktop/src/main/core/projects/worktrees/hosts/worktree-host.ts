import type path from 'node:path';
import type { FileEntry } from '@main/core/fs/types';

export type WorktreeHostPathApi = Pick<typeof path, 'dirname' | 'join'>;

export interface WorktreeHost {
  readonly pathApi: WorktreeHostPathApi;
  allowPath?(path: string): Promise<void>;
  existsAbsolute(path: string): Promise<boolean>;
  mkdirAbsolute(path: string, options?: { recursive?: boolean }): Promise<void>;
  removeAbsolute(
    path: string,
    options?: { recursive?: boolean }
  ): Promise<{ success: boolean; error?: string }>;
  realPathAbsolute(path: string): Promise<string>;
  globAbsolute(pattern: string, options: { cwd: string; dot?: boolean }): Promise<string[]>;
  readFileAbsolute(path: string): Promise<string>;
  copyFileAbsolute(src: string, dest: string): Promise<void>;
  statAbsolute(path: string): Promise<FileEntry | null>;
}
