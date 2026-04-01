export const TERMINAL_PROVIDER_IDS = [
  'qwen',
  'codex',
  'claude',
  'droid',
  'gemini',
  'cursor',
  'copilot',
  'amp',
  'opencode',
  'hermes',
  'charm',
  'auggie',
  'kimi',
  'kiro',
  'rovo',
  'pi',
  'autohand',
  'forge',
] as const;

export type TerminalProviderId = (typeof TERMINAL_PROVIDER_IDS)[number];
