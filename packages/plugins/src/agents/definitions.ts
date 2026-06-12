// Browser-safe: imports only declarative plugin definitions — no Node.js deps.
import { type CLIAgentPluginDefinition, createPluginRegistry } from '@emdash/shared/agents/plugins';
import { plugin as amp } from './impl/amp';
import { plugin as antigravity } from './impl/antigravity';
import { plugin as auggie } from './impl/auggie';
import { plugin as autohand } from './impl/autohand';
import { plugin as charm } from './impl/charm';
import { plugin as claude } from './impl/claude';
import { plugin as cline } from './impl/cline';
import { plugin as codebuff } from './impl/codebuff';
import { plugin as codex } from './impl/codex';
import { plugin as commandcode } from './impl/commandcode';
import { plugin as continueCli } from './impl/continue';
import { plugin as copilot } from './impl/copilot';
import { plugin as cursor } from './impl/cursor';
import { plugin as devin } from './impl/devin';
import { plugin as droid } from './impl/droid';
import { plugin as freebuff } from './impl/freebuff';
import { plugin as gemini } from './impl/gemini';
import { plugin as goose } from './impl/goose';
import { plugin as grok } from './impl/grok';
import { plugin as hermes } from './impl/hermes';
import { plugin as jules } from './impl/jules';
import { plugin as junie } from './impl/junie';
import { plugin as kilocode } from './impl/kilocode';
import { plugin as kimi } from './impl/kimi';
import { plugin as kiro } from './impl/kiro';
import { plugin as letta } from './impl/letta';
import { plugin as mistral } from './impl/mistral';
import { plugin as opencode } from './impl/opencode';
import { plugin as pi } from './impl/pi';
import { plugin as qwen } from './impl/qwen';
import { plugin as rovo } from './impl/rovo';

export const definitionRegistry = createPluginRegistry<CLIAgentPluginDefinition>();

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
  definitionRegistry.register(p);
}
