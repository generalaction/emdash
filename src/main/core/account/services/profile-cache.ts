import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'path';
import { app } from 'electron';
import { log } from '@main/lib/logger';

const PROFILE_FILENAME = 'emdash-account.json';

export interface CachedProfile {
  hasAccount: boolean;
  userId: string;
  username: string;
  avatarUrl: string;
  email: string;
  lastValidated: string;
}

export class AccountProfileCache {
  private getPath(): string {
    return join(app.getPath('userData'), PROFILE_FILENAME);
  }

  read(): CachedProfile | null {
    try {
      const filePath = this.getPath();
      if (!existsSync(filePath)) return null;
      const data = readFileSync(filePath, 'utf-8');
      return JSON.parse(data) as CachedProfile;
    } catch {
      return null;
    }
  }

  write(profile: CachedProfile): void {
    try {
      const dir = app.getPath('userData');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.getPath(), JSON.stringify(profile, null, 2));
    } catch (error) {
      log.error('Failed to write profile cache:', error);
    }
  }
}

export const accountProfileCache = new AccountProfileCache();
