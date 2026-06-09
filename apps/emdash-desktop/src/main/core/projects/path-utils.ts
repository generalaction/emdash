import fs from 'node:fs';

export function checkIsValidDirectory(path: string): boolean {
  return fs.existsSync(path) && fs.statSync(path).isDirectory();
}
