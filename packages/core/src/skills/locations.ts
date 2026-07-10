/**
 * User-level directories used by the Agent Skills ecosystem and supported
 * coding agents. Earlier entries take precedence when a skill is mirrored
 * into more than one directory.
 */
export const USER_SKILLS_DIRS = [
  '.agentskills',
  '.agents/skills',
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
  '.vibe/skills',
  '.gemini/antigravity/skills',
  '.config/agents/skills',
  '.config/mimocode/skills',
] as const;
