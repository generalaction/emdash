// The single plugin registry
import type { CLIAgentPluginProvider } from '@emdash/core/agents/plugins';
import { createPluginRegistry } from '@emdash/shared/plugins';
import { provider as amp } from './impl/amp';
import { provider as antigravity } from './impl/antigravity';
import { provider as auggie } from './impl/auggie';
import { provider as autohand } from './impl/autohand';
import { provider as charm } from './impl/charm';
import { provider as claude } from './impl/claude';
import { provider as cline } from './impl/cline';
import { provider as codebuff } from './impl/codebuff';
import { provider as codex } from './impl/codex';
import { provider as commandcode } from './impl/commandcode';
import { provider as continueCli } from './impl/continue';
import { provider as copilot } from './impl/copilot';
import { provider as cursor } from './impl/cursor';
import { provider as devin } from './impl/devin';
import { provider as droid } from './impl/droid';
import { provider as freebuff } from './impl/freebuff';
import { provider as gemini } from './impl/gemini';
import { provider as goose } from './impl/goose';
import { provider as grok } from './impl/grok';
import { provider as hermes } from './impl/hermes';
import { provider as jules } from './impl/jules';
import { provider as junie } from './impl/junie';
import { provider as kilocode } from './impl/kilocode';
import { provider as kimi } from './impl/kimi';
import { provider as kiro } from './impl/kiro';
import { provider as letta } from './impl/letta';
import { provider as mimocode } from './impl/mimocode';
import { provider as mistral } from './impl/mistral';
import { provider as opencode } from './impl/opencode';
import { provider as pi } from './impl/pi';
import { provider as qoder } from './impl/qoder';
import { provider as qwen } from './impl/qwen';
import { provider as rovo } from './impl/rovo';

export { asAgentProviderId } from './types';
export type { AgentProviderId } from './types';

export const pluginRegistry = createPluginRegistry<CLIAgentPluginProvider>();

for (const p of [
  codex,
  claude,
  grok,
  devin,
  qwen,
  droid,
  gemini,
  antigravity,
  cursor,
  copilot,
  amp,
  commandcode,
  opencode,
  hermes,
  charm,
  auggie,
  goose,
  kimi,
  kilocode,
  kiro,
  rovo,
  cline,
  continueCli,
  codebuff,
  freebuff,
  mistral,
  jules,
  junie,
  pi,
  qoder,
  letta,
  autohand,
  mimocode,
]) {
  pluginRegistry.register(p);
}
