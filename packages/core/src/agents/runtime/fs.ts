export interface PluginFs {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<string[]>;
  copyDirectory?(sourcePath: string, targetPath: string): Promise<boolean>;
  symlink?(target: string, linkPath: string): Promise<void>;
  readLink?(path: string): Promise<string | null>;
}
