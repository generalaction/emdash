import * as fs from 'fs';

export function safeStat(pathname: string): fs.Stats | null {
  try {
    return fs.statSync(pathname);
  } catch {
    return null;
  }
}
