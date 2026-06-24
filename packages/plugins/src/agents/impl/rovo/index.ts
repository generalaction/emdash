import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import { buildStandardCommand } from '@emdash/core/agents/plugins/helpers';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'rovo',
    name: 'Rovo Dev',
    description:
      'Atlassian Rovo Dev CLI integrates terminal assistance with Jira, Confluence, and Bitbucket workflows.',
    websiteUrl:
      'https://support.atlassian.com/rovo/docs/install-and-run-rovo-dev-cli-on-your-device/',
  },
  {
    autoApprove: {
      kind: 'supported',
    },
    hostDependency: {
      id: 'rovo',
      binaryNames: ['acli'],
      installCommands: {
        macos: [
          {
            method: 'homebrew',
            command: 'brew tap atlassian/homebrew-acli && brew install acli',
          },
        ],
        linux: [
          {
            method: 'apt',
            command:
              'sudo apt-get install -y wget gnupg2 && sudo mkdir -p -m 755 /etc/apt/keyrings && wget -nv -O- https://acli.atlassian.com/gpg/public-key.asc | sudo gpg --dearmor -o /etc/apt/keyrings/acli-archive-keyring.gpg && sudo chmod go+r /etc/apt/keyrings/acli-archive-keyring.gpg && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/acli-archive-keyring.gpg] https://acli.atlassian.com/linux/deb stable main" | sudo tee /etc/apt/sources.list.d/acli.list > /dev/null && sudo apt update && sudo apt install -y acli',
          },
        ],
      },
      updates: {
        kind: 'none',
      },
    },
    prompt: {
      kind: 'argv',
      flag: '',
    },
    sessions: {
      kind: 'stateless',
    },
  },
  { icon }
);

export const provider = registerPluginBehavior(plugin, {
  prompt: {
    buildCommand: (ctx) =>
      buildStandardCommand(ctx, {
        defaultArgs: ['rovodev', 'run'],
        autoApproveFlag: '--yolo',
        initialPromptFlag: '',
      }),
  },
});
