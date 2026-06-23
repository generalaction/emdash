// The single plugin registry
import { type CLIAgentPluginProvider, createPluginRegistry } from '@emdash/core/agents/plugins';
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
import { provider as mistral } from './impl/mistral';
import { provider as opencode } from './impl/opencode';
import { provider as pi } from './impl/pi';
import { provider as qwen } from './impl/qwen';
import { provider as rovo } from './impl/rovo';

export const pluginRegistry = createPluginRegistry<CLIAgentPluginProvider>();

for (const p of [
  amp,
  antigravity,
  auggie,
  autohand,
  charm,
  claude,
  cline,
  codebuff,
  codex,
  commandcode,
  continueCli,
  copilot,
  cursor,
  devin,
  droid,
  freebuff,
  gemini,
  goose,
  grok,
  hermes,
  jules,
  junie,
  kilocode,
  kimi,
  kiro,
  letta,
  mistral,
  opencode,
  pi,
  qwen,
  rovo,
]) {
  pluginRegistry.register(p);
}
