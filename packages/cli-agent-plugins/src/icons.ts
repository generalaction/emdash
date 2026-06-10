// Renderer-safe: imports only React icon components — no Node.js deps, no functions.
// Import directly from icon files (not barrel index) to avoid pulling in Node.js-only provider code.
import { CLIAgentPluginIconRegistry } from './core';
import AmpIcon from './impl/amp/icon';
import AntigravityIcon from './impl/antigravity/icon';
import AuggieIcon from './impl/auggie/icon';
import AutohandIcon from './impl/autohand/icon';
import CharmIcon from './impl/charm/icon';
import ClaudeIcon from './impl/claude/icon';
import ClineIcon from './impl/cline/icon';
import CodebuffIcon from './impl/codebuff/icon';
import CodexIcon from './impl/codex/icon';
import CommandcodeIcon from './impl/commandcode/icon';
import ContinueIcon from './impl/continue/icon';
import CopilotIcon from './impl/copilot/icon';
import CursorIcon from './impl/cursor/icon';
import DevinIcon from './impl/devin/icon';
import DroidIcon from './impl/droid/icon';
import FreebuffIcon from './impl/freebuff/icon';
import GeminiIcon from './impl/gemini/icon';
import GooseIcon from './impl/goose/icon';
import GrokIcon from './impl/grok/icon';
import HermesIcon from './impl/hermes/icon';
import JulesIcon from './impl/jules/icon';
import JunieIcon from './impl/junie/icon';
import KilocodeIcon from './impl/kilocode/icon';
import KimiIcon from './impl/kimi/icon';
import KiroIcon from './impl/kiro/icon';
import LettaIcon from './impl/letta/icon';
import MistralIcon from './impl/mistral/icon';
import OpenCodeIcon from './impl/opencode/icon';
import PiIcon from './impl/pi/icon';
import QwenIcon from './impl/qwen/icon';
import RovoIcon from './impl/rovo/icon';

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
