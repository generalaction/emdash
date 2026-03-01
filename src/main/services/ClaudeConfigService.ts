import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { log } from '../lib/logger';
import { getAppSettings } from '../settings';

function getClaudeConfigPath(): string {
  return join(homedir(), '.claude.json');
}

/**
 * Auto-trust a worktree directory for Claude Code if the setting is enabled.
 * No-op for non-Claude providers.
 */
export function maybeAutoTrustForClaude(providerId: string, cwd?: string): void {
  if (!cwd) return;
  if (providerId !== 'claude') return;
  if (!getAppSettings().tasks?.autoTrustWorktrees) return;
  ensureClaudeTrust(cwd);
}

/**
 * Ensure that Claude Code trusts the given worktree directory by writing
 * the trust entry into ~/.claude.json. Idempotent and non-fatal — errors
 * are logged but never propagated so PTY spawning is never blocked.
 */
export function ensureClaudeTrust(worktreePath: string): void {
  try {
    const configPath = getClaudeConfigPath();
    const resolvedPath = resolve(worktreePath);
    let config: Record<string, any> = {};

    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, 'utf8');
      config = JSON.parse(raw);
    }

    if (!config.projects || typeof config.projects !== 'object' || Array.isArray(config.projects)) {
      config.projects = {};
    }

    const existing = config.projects[resolvedPath];
    if (
      existing &&
      existing.hasTrustDialogAccepted === true &&
      existing.hasCompletedProjectOnboarding === true
    ) {
      return; // Already trusted
    }

    config.projects[resolvedPath] = {
      ...existing,
      hasTrustDialogAccepted: true,
      hasCompletedProjectOnboarding: true,
    };

    // Atomic write: write to temp file then rename
    const tmpPath = configPath + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf8');
      renameSync(tmpPath, configPath);
    } catch (writeErr) {
      try {
        unlinkSync(tmpPath);
      } catch {}
      throw writeErr;
    }
  } catch (err) {
    log.warn('ClaudeConfigService: failed to write trust entry', {
      path: worktreePath,
      error: String((err as Error)?.message || err),
    });
  }
}
