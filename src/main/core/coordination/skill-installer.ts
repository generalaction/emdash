import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { log } from '@main/lib/logger';
import { SKILL_CONTENT, SKILL_CONTENT_VERSION } from './skill-content';

const SKILL_ID = 'emdash-coord';

/**
 * Per-agent install targets. The skill is installed only when the agent's
 * config dir already exists — we don't materialise `~/.codex/` on systems
 * where the user hasn't installed Codex.
 *
 * Claude Code uses `commands/` instead of `skills/` (its current convention
 * for invocable instructions); the other CLIs use `skills/`. See
 * `src/shared/skills/agentTargets.ts` for the canonical paths.
 */
const TARGETS: Array<{ agentId: string; configDir: string; installDir: string }> = [
  {
    agentId: 'claude-code',
    configDir: path.join(homedir(), '.claude'),
    installDir: path.join(homedir(), '.claude', 'commands', SKILL_ID),
  },
  {
    agentId: 'codex',
    configDir: path.join(homedir(), '.codex'),
    installDir: path.join(homedir(), '.codex', 'skills', SKILL_ID),
  },
  {
    agentId: 'opencode',
    configDir: path.join(homedir(), '.config', 'opencode'),
    installDir: path.join(homedir(), '.config', 'opencode', 'skills', SKILL_ID),
  },
];

const VERSION_HEADER = `<!-- emdash-coord-version: ${SKILL_CONTENT_VERSION} -->\n`;
const VERSION_LINE_PREFIX = '<!-- emdash-coord-version:';

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Idempotently install the bundled emdash-coord SKILL.md into each detected
 * agent's skill directory. Existing content is left alone unless the version
 * header is older (or missing) — that way user edits to other parts of
 * `~/.claude/commands` aren't disturbed.
 *
 * Safe to call repeatedly; cheap when no work is needed.
 */
export async function ensureBundledSkill(): Promise<void> {
  const desiredContent = VERSION_HEADER + SKILL_CONTENT;

  for (const target of TARGETS) {
    if (!(await dirExists(target.configDir))) continue;

    const skillFile = path.join(target.installDir, 'SKILL.md');
    let existing: string | null = null;
    try {
      existing = await readFile(skillFile, 'utf-8');
    } catch {
      existing = null;
    }

    if (existing) {
      const firstLine = existing.split('\n', 1)[0] ?? '';
      // If marker present and version matches, nothing to do.
      if (firstLine.startsWith(VERSION_LINE_PREFIX)) {
        if (firstLine.trim() === VERSION_HEADER.trim()) continue;
      } else {
        // No marker — assume user-authored file at this path, leave it alone.
        log.warn('coordination: skipping skill install — unmarked file present', {
          agentId: target.agentId,
          path: skillFile,
        });
        continue;
      }
    }

    try {
      await mkdir(target.installDir, { recursive: true });
      await writeFile(skillFile, desiredContent, 'utf-8');
      log.info('coordination: installed emdash-coord skill', {
        agentId: target.agentId,
        path: skillFile,
      });
    } catch (e) {
      log.warn('coordination: skill install failed', {
        agentId: target.agentId,
        path: skillFile,
        error: String(e),
      });
    }
  }
}
