// Renderer-safe: imports only React icon components — no Node.js deps, no functions.
import { CLIAgentPluginIconRegistry } from './core';

import { Icon as AmpIcon } from './impl/amp';
import { Icon as AntigravityIcon } from './impl/antigravity';
import { Icon as AuggieIcon } from './impl/auggie';
import { Icon as AutohandIcon } from './impl/autohand';
import { Icon as CharmIcon } from './impl/charm';
import { Icon as ClaudeIcon } from './impl/claude';
import { Icon as ClineIcon } from './impl/cline';
import { Icon as CodebuffIcon } from './impl/codebuff';
import { Icon as CodexIcon } from './impl/codex';
import { Icon as CommandcodeIcon } from './impl/commandcode';
import { Icon as ContinueIcon } from './impl/continue';
import { Icon as CopilotIcon } from './impl/copilot';
import { Icon as CursorIcon } from './impl/cursor';
import { Icon as DevinIcon } from './impl/devin';
import { Icon as DroidIcon } from './impl/droid';
import { Icon as FreebuffIcon } from './impl/freebuff';
import { Icon as GeminiIcon } from './impl/gemini';
import { Icon as GooseIcon } from './impl/goose';
import { Icon as GrokIcon } from './impl/grok';
import { Icon as HermesIcon } from './impl/hermes';
import { Icon as JunieIcon } from './impl/junie';
import { Icon as JulesIcon } from './impl/jules';
import { Icon as KilocodeIcon } from './impl/kilocode';
import { Icon as KimiIcon } from './impl/kimi';
import { Icon as KiroIcon } from './impl/kiro';
import { Icon as LettaIcon } from './impl/letta';
import { Icon as MistralIcon } from './impl/mistral';
import { Icon as OpenCodeIcon } from './impl/opencode';
import { Icon as PiIcon } from './impl/pi';
import { Icon as QwenIcon } from './impl/qwen';
import { Icon as RovoIcon } from './impl/rovo';

export const iconRegistry = new CLIAgentPluginIconRegistry();

const entries: [string, React.ComponentType<{ size?: number; mode?: 'light' | 'dark' }>][] = [
  ['amp', AmpIcon],
  ['antigravity', AntigravityIcon],
  ['auggie', AuggieIcon],
  ['autohand', AutohandIcon],
  ['charm', CharmIcon],
  ['claude', ClaudeIcon],
  ['cline', ClineIcon],
  ['codebuff', CodebuffIcon],
  ['codex', CodexIcon],
  ['commandcode', CommandcodeIcon],
  ['continue', ContinueIcon],
  ['copilot', CopilotIcon],
  ['cursor', CursorIcon],
  ['devin', DevinIcon],
  ['droid', DroidIcon],
  ['freebuff', FreebuffIcon],
  ['gemini', GeminiIcon],
  ['goose', GooseIcon],
  ['grok', GrokIcon],
  ['hermes', HermesIcon],
  ['junie', JunieIcon],
  ['jules', JulesIcon],
  ['kilocode', KilocodeIcon],
  ['kimi', KimiIcon],
  ['kiro', KiroIcon],
  ['letta', LettaIcon],
  ['mistral', MistralIcon],
  ['opencode', OpenCodeIcon],
  ['pi', PiIcon],
  ['qwen', QwenIcon],
  ['rovo', RovoIcon],
];

for (const [id, icon] of entries) {
  iconRegistry.register(id, icon);
}
