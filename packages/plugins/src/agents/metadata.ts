// Renderer-safe: imports only declarative metadata — no Node.js deps, no functions.
import { CLIAgentPluginMetadataRegistry } from '@emdash/shared/agents/plugins';
import { metadata as amp } from './impl/amp';
import { metadata as antigravity } from './impl/antigravity';
import { metadata as auggie } from './impl/auggie';
import { metadata as autohand } from './impl/autohand';
import { metadata as charm } from './impl/charm';
import { metadata as claude } from './impl/claude';
import { metadata as cline } from './impl/cline';
import { metadata as codebuff } from './impl/codebuff';
import { metadata as codex } from './impl/codex';
import { metadata as commandcode } from './impl/commandcode';
import { metadata as continueCli } from './impl/continue';
import { metadata as copilot } from './impl/copilot';
import { metadata as cursor } from './impl/cursor';
import { metadata as devin } from './impl/devin';
import { metadata as droid } from './impl/droid';
import { metadata as freebuff } from './impl/freebuff';
import { metadata as gemini } from './impl/gemini';
import { metadata as goose } from './impl/goose';
import { metadata as grok } from './impl/grok';
import { metadata as hermes } from './impl/hermes';
import { metadata as jules } from './impl/jules';
import { metadata as junie } from './impl/junie';
import { metadata as kilocode } from './impl/kilocode';
import { metadata as kimi } from './impl/kimi';
import { metadata as kiro } from './impl/kiro';
import { metadata as letta } from './impl/letta';
import { metadata as mistral } from './impl/mistral';
import { metadata as opencode } from './impl/opencode';
import { metadata as pi } from './impl/pi';
import { metadata as qwen } from './impl/qwen';
import { metadata as rovo } from './impl/rovo';

export const metadataRegistry = new CLIAgentPluginMetadataRegistry();

for (const m of [
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
  junie,
  jules,
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
  metadataRegistry.register(m);
}
