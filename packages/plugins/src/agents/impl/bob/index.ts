import {
  definePlugin,
  registerPluginBehavior,
} from '@emdash/core/services/agent-plugins/api/plugins';
import {
  bobMcpAdapter,
  buildStandardCommand,
  npmDependency,
} from '@emdash/core/services/agent-plugins/api/plugins/helpers';
import { createNativeAcpBehavior } from '../../helpers/acp-stdio';
import { icon } from './icon';
import { buildBobTrustBehavior } from './trust';

// IBM's installer wraps the same global npm install of `@ibm/bob` and also removes the legacy
// `bobshell` package, so it is the recommended option where a script is available.
const installScript = 'curl -fsSL https://bob.ibm.com/download/bobshell.sh | bash';

export const plugin = definePlugin(
  {
    id: 'bob',
    name: 'IBM Bob',
    description:
      "IBM's Bob Shell coding agent for the terminal, with modes, skills, subagents, and MCP support.",
    websiteUrl: 'https://bob.ibm.com/docs/shell',
  },
  {
    acp: {
      kind: 'supported',
    },
    autoApprove: {
      kind: 'supported',
    },
    hostDependency: npmDependency({
      id: 'bob',
      package: '@ibm/bob',
      // Lets the optional OfficeCLI dependency run its install script, as IBM documents.
      installFlags: '--allow-scripts=@officecli/officecli',
      recommended: false,
      installDocs: 'https://bob.ibm.com/docs/shell/getting-started/install-and-setup',
      extraOptions: {
        macos: [{ method: 'curl', command: installScript, recommended: true }],
        linux: [{ method: 'curl', command: installScript, recommended: true }],
        windows: [
          {
            method: 'powershell',
            command:
              'powershell -ep Bypass "iwr https://bob.ibm.com/download/bobshell.ps1 -OutFile $env:TMP\\bob.ps1; &$env:TMP\\bob.ps1"',
            recommended: true,
          },
        ],
      },
    }),
    mcp: {
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio', 'http'],
    },
    prompt: {
      // `bob chat [prompt...]` seeds the interactive session. The prompt goes after `--`
      // because Bob rejects a positional that looks like an option (`--help me ...`).
      kind: 'argv',
      flag: '--',
    },
    sessions: {
      kind: 'resumable',
    },
    trust: {
      kind: 'supported',
    },
  },
  { icon }
);

export const provider = registerPluginBehavior(plugin, {
  acp: createNativeAcpBehavior(() => ({
    args: ['acp'],
  })),
  prompt: {
    buildCommand: (ctx) =>
      buildStandardCommand(ctx, {
        // `chat` is the interactive TUI; `bob run` and `-p` are headless and exit.
        defaultArgs: ['chat'],
        autoApproveFlag: '--auto-approve',
        initialPromptFlag: '--',
        // A bare `--resume` reopens the most recent task of the current workspace.
        resumeFlag: '--resume',
      }),
  },
  mcp: bobMcpAdapter(),
  trust: buildBobTrustBehavior(),
});
