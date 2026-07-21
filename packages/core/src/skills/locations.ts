/**
 * User-level directories used by the Agent Skills ecosystem and supported
 * coding agents. Earlier entries take precedence when a skill is mirrored
 * into more than one directory.
 */
export const EMDASH_SKILLS_DIR = '.agentskills';

export const AGENT_SKILLS_DIRS = [
  '.agents/skills',
  '.agent/skills',
  '.claude/skills',
  '.cursor/skills',
  '.codex/skills',
  '.config/opencode/skills',
  '.gemini/skills',
  '.copilot/skills',
  '.qwen/skills',
  '.factory/skills',
  '.config/goose/skills',
  '.continue/skills',
  '.kilocode/skills',
  '.kiro/skills',
  '.qoder/skills',
  '.junie/skills',
  '.commandcode/skills',
  '.autohand/skills',
  '.augment/skills',
  '.hermes/skills',
  '.pi/agent/skills',
  '.config/devin/skills',
  '.rovodev/skills',
  '.roo/skills',
  '.vibe/skills',
  '.gemini/antigravity/skills',
  '.config/agents/skills',
  '.config/mimocode/skills',
] as const;

export const USER_SKILLS_DIRS = [EMDASH_SKILLS_DIR, ...AGENT_SKILLS_DIRS] as const;
