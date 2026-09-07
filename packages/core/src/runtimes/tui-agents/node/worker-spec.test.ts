import { createPluginRegistry } from '@emdash/shared/plugins';
import { describe, expect, it } from 'vitest';
import type { CLIAgentPluginProvider } from '#services/agent-plugins/api/plugins';
import { tuiAgentsWorkerSpec, type TuiAgentsWorkerSpecInput } from './worker-spec';

describe('tuiAgentsWorkerSpec', () => {
  it('keeps interactive sessions alive until explicit cleanup', () => {
    const env = { PATH: '/usr/bin' };
    const [component, options] = tuiAgentsWorkerSpec({
      pluginRegistry: createPluginRegistry<CLIAgentPluginProvider>(),
      executable: '/w/tui-agents.mjs',
      env,
      dependencies: {} as TuiAgentsWorkerSpecInput['dependencies'],
      intentsFilePath: '/data/tui-intents.json',
    });
    expect(component.id).toBe('tui-agents');
    expect(options.name).toBe('tui-agents');
    expect(options.env).toBe(env);
    expect(component.requirements).toHaveProperty('userEnv');
    expect(options.supervision).toBeUndefined();
    expect(component.configSchema.parse(options.config)).toEqual({
      intentsFilePath: '/data/tui-intents.json',
      lifecycle: { session: { kind: 'always' } },
    });
  });
});
