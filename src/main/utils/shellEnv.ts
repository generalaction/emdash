/**
 * Utilities for detecting the SSH agent socket when the app is launched
 * from a GUI and may not have inherited it from the user's shell session.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Common SSH agent socket locations to check as fallback
 */
const COMMON_SSH_AGENT_LOCATIONS: ReadonlyArray<{ path: string; description: string }> = [
  // macOS launchd
  { path: '/private/tmp/com.apple.launchd.*/Listeners', description: 'macOS launchd' },
  // 1Password SSH agent (macOS)
  {
    path: path.join(os.homedir(), 'Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock'),
    description: '1Password SSH agent',
  },
  // Generic temp directory patterns
  { path: path.join(os.tmpdir(), 'ssh-??????????', 'agent.*'), description: 'OpenSSH temp' },
  // User's .ssh directory
  { path: path.join(os.homedir(), '.ssh', 'agent.*'), description: 'User SSH directory' },
  // Linux keyring
  { path: path.join(os.tmpdir(), 'keyring-*/ssh'), description: 'GNOME Keyring' },
  // GnuPG agent SSH support
  { path: path.join(os.homedir(), '.gnupg', 'S.gpg-agent.ssh'), description: 'GnuPG agent' },
];

/**
 * Checks if a path is a socket file
 */
function isSocketFile(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    return stats.isSocket();
  } catch {
    return false;
  }
}

/**
 * Expands glob patterns to find matching paths
 */
function expandGlob(pattern: string): string[] {
  try {
    // Simple glob expansion for patterns like /tmp/ssh-*/agent.*
    const parts = pattern.split('/');
    let matches: string[] = [''];

    for (const part of parts) {
      if (!part) continue;

      if (part.includes('*') || part.includes('?')) {
        // This part has wildcards
        const regex = new RegExp(
          '^' + part.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
        );
        const newMatches: string[] = [];

        for (const currentPath of matches) {
          try {
            const dir = currentPath || '/';
            const entries = fs.readdirSync(dir);
            for (const entry of entries) {
              if (regex.test(entry)) {
                newMatches.push(path.join(currentPath, entry));
              }
            }
          } catch {}
        }

        matches = newMatches;
      } else {
        // Regular path component
        matches = matches.map((m) => path.join(m, part));
      }
    }

    return matches.filter((m) => m !== '');
  } catch {
    return [];
  }
}

/**
 * Detects the SSH_AUTH_SOCK environment variable.
 *
 * In normal operation, resolveUserEnv() (called at startup) will have already
 * merged SSH_AUTH_SOCK from the login shell into process.env, so the first
 * check here returns immediately. The remaining steps are fallbacks for
 * environments where resolveUserEnv() timed out, was skipped (AppImage, CI),
 * or the user's shell simply doesn't export SSH_AUTH_SOCK (e.g. custom
 * socket managers like 1Password).
 *
 * @returns The path to the SSH agent socket, or undefined if not found
 */
export function detectSshAuthSock(): string | undefined {
  // Fast path — set by resolveUserEnv() at startup in the common case.
  if (process.env.SSH_AUTH_SOCK) {
    return process.env.SSH_AUTH_SOCK;
  }

  // macOS launchd (fast, no shell spawn)
  if (process.platform === 'darwin') {
    try {
      const result = execSync('launchctl getenv SSH_AUTH_SOCK', {
        encoding: 'utf8',
        timeout: 1000,
      });
      const socket = result.trim();
      if (socket) {
        return socket;
      }
    } catch {
      // launchctl detection failed
    }
  }

  // Check common socket locations as fallback
  for (const location of COMMON_SSH_AGENT_LOCATIONS) {
    try {
      if (location.path.includes('*') || location.path.includes('?')) {
        const matches = expandGlob(location.path);
        for (const match of matches) {
          if (isSocketFile(match)) {
            return match;
          }
        }
      } else if (isSocketFile(location.path)) {
        return location.path;
      }
    } catch {
      // Continue to next location
    }
  }

  return undefined;
}
