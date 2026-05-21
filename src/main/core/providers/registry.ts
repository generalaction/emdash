import type { ProviderClassifier } from '@main/core/agent-hooks/classifiers/base';
import { createGenericClassifier } from '@main/core/agent-hooks/classifiers/generic';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { ampPlugin } from './plugins/amp';
import { antigravityPlugin } from './plugins/antigravity';
import { auggiePlugin } from './plugins/auggie';
import { autohandPlugin } from './plugins/autohand';
import { charmPlugin } from './plugins/charm';
import { claudePlugin } from './plugins/claude';
import { clinePlugin } from './plugins/cline';
import { codebuffPlugin, freebuffPlugin } from './plugins/codebuff';
import { codexPlugin } from './plugins/codex';
import { continuePlugin } from './plugins/continue';
import { copilotPlugin } from './plugins/copilot';
import { cursorPlugin } from './plugins/cursor';
import { devinPlugin } from './plugins/devin';
import { droidPlugin } from './plugins/droid';
import { geminiPlugin } from './plugins/gemini';
import { goosePlugin } from './plugins/goose';
import { grokPlugin } from './plugins/grok';
import { hermesPlugin } from './plugins/hermes';
import { julesPlugin } from './plugins/jules';
import { juniePlugin } from './plugins/junie';
import { kilocodePlugin } from './plugins/kilocode';
import { kimiPlugin } from './plugins/kimi';
import { kiroPlugin } from './plugins/kiro';
import { lettaPlugin } from './plugins/letta';
import { mistralPlugin } from './plugins/mistral';
import { openCodePlugin } from './plugins/opencode';
import { piPlugin } from './plugins/pi';
import { qwenPlugin } from './plugins/qwen';
import { rovoPlugin } from './plugins/rovo';
import type { ProviderPlugin, ProviderPluginDeps, ProviderPluginFactory } from './types';

const pluginFactories = new Map<AgentProviderId, ProviderPluginFactory>([
  ['amp', ampPlugin],
  ['antigravity', antigravityPlugin],
  ['auggie', auggiePlugin],
  ['autohand', autohandPlugin],
  ['charm', charmPlugin],
  ['claude', claudePlugin],
  ['cline', clinePlugin],
  ['codebuff', codebuffPlugin],
  ['codex', codexPlugin],
  ['continue', continuePlugin],
  ['copilot', copilotPlugin],
  ['cursor', cursorPlugin],
  ['devin', devinPlugin],
  ['droid', droidPlugin],
  ['freebuff', freebuffPlugin],
  ['gemini', geminiPlugin],
  ['goose', goosePlugin],
  ['grok', grokPlugin],
  ['hermes', hermesPlugin],
  ['jules', julesPlugin],
  ['junie', juniePlugin],
  ['kilocode', kilocodePlugin],
  ['kimi', kimiPlugin],
  ['kiro', kiroPlugin],
  ['letta', lettaPlugin],
  ['mistral', mistralPlugin],
  ['opencode', openCodePlugin],
  ['pi', piPlugin],
  ['qwen', qwenPlugin],
  ['rovo', rovoPlugin],
]);

/**
 * Create a plugin instance scoped to a task's I/O context.
 * Returns undefined for providers with no registered factory.
 */
export function createPlugin(
  id: AgentProviderId,
  deps: ProviderPluginDeps
): ProviderPlugin | undefined {
  return pluginFactories.get(id)?.(deps);
}

/**
 * Get the raw factory for a provider, if registered.
 */
export function getProviderPlugin(id: AgentProviderId): ProviderPluginFactory | undefined {
  return pluginFactories.get(id);
}

/**
 * Create a classifier for the given provider, falling back to the generic
 * classifier if the provider has no plugin or its plugin has no createClassifier.
 */
export function createClassifier(
  id: AgentProviderId,
  plugin: ProviderPlugin | undefined
): ProviderClassifier {
  return plugin?.createClassifier?.() ?? createGenericClassifier();
}
