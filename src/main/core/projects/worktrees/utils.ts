import fs from 'fs';
import path from 'path';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';

export const ensureLocalWorktreeDirectory = ({
  directory,
  projectName,
}: {
  directory?: string;
  projectName: string;
}): string => {
  directory = directory ?? path.join('emdash', 'projects', 'worktrees', projectName);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
  return directory;
};

export const ensureSshWorktreeDirectory = async ({
  directory,
  projectName,
  rootFs,
}: {
  directory?: string;
  projectName: string;
  rootFs: SshFileSystem;
}): Promise<string> => {
  directory = directory ?? path.join('emdash', 'projects', 'worktrees', projectName);

  const exists = await rootFs.exists(directory);
  if (!exists) {
    await rootFs.mkdir(directory, { recursive: true });
  }
  return directory;
};
