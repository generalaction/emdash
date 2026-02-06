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
  'charm',
  'auggie',
  'kimi',
  'kiro',
  'rovo',
] as const;

export type TerminalProviderId = (typeof TERMINAL_PROVIDER_IDS)[number];
