import {
  definePlugin,
  registerPluginBehavior,
} from '@emdash/core/services/agent-plugins/api/plugins';
import {
  buildStandardCommand,
  npmDependency,
} from '@emdash/core/services/agent-plugins/api/plugins/helpers';
import { createNativeAcpBehavior } from '../../helpers/acp-stdio';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'codewhale',
    name: 'Codewhale',
    description: 'Open-source Rust terminal coding agent supporting hosted and local models.',
    websiteUrl: 'https://codewhale.net',
  },
  {
    acp: { kind: 'supported' },
    hostDependency: npmDependency({
      id: 'codewhale',
      package: 'codewhale',
      installDocs: 'https://github.com/codewhale-hq/Codewhale#installation',
    }),
    prompt: { kind: 'argv', flag: '--prompt' },
    sessions: { kind: 'stateless' },
  },
  { icon }
);

export const provider = registerPluginBehavior(plugin, {
  acp: createNativeAcpBehavior(() => ({ args: ['serve', '--acp'] })),
  prompt: {
    buildCommand: (ctx) =>
      buildStandardCommand(ctx, {
        defaultArgs: ['--fresh'],
        initialPromptFlag: '--prompt',
      }),
  },
});
