// Types-only entry point. Import from './definitions' or './providers' for runtime use.
export * from '@emdash/shared/agents/plugins';

export const AGENT_IDS = [
  'amp',
  'antigravity',
  'auggie',
  'autohand',
  'charm',
  'claude',
  'cline',
  'codebuff',
  'codex',
  'commandcode',
  'continue',
  'copilot',
  'cursor',
  'devin',
  'droid',
  'freebuff',
  'gemini',
  'goose',
  'grok',
  'hermes',
  'jules',
  'junie',
  'kilocode',
  'kimi',
  'kiro',
  'letta',
  'mistral',
  'opencode',
  'pi',
  'qwen',
  'rovo',
] as const;

export type AgentId = (typeof AGENT_IDS)[number];
