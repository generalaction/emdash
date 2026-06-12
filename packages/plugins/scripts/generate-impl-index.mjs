#!/usr/bin/env node
/**
 * Generate new index.ts for all 31 impl plugins using definePlugin/registerPluginBehavior.
 *
 * Data collected from reading each old index.ts file.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';

const IMPL_DIR = new URL('../src/agents/impl', import.meta.url).pathname;

// All plugin definitions
const PLUGINS = [
  {
    id: 'amp',
    name: 'Amp',
    description:
      'Amp Code CLI for agentic coding sessions against your repository from the terminal.',
    websiteUrl: 'https://ampcode.com/manual#install',
    autoApprove: { kind: 'supported' },
    effort: { kind: 'none' },
    hooks: { kind: 'none' },
    hostDependency: {
      binaryNames: ['amp'],
      installCommands: {
        macos: [{ method: 'npm', command: 'npm install -g @sourcegraph/amp@latest' }],
        linux: [{ method: 'npm', command: 'npm install -g @sourcegraph/amp@latest' }],
        windows: [{ method: 'npm', command: 'npm install -g @sourcegraph/amp@latest' }],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'npm', package: '@sourcegraph/amp' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'supported', scope: 'global', supportedTransports: ['stdio', 'http'] },
    models: { kind: 'none' },
    plugins: { kind: 'file-drop', scope: 'workspace' },
    sessions: { kind: 'stateless' },
    prompt: { kind: 'stdin-pipe' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          autoApproveFlag: '--dangerously-allow-all',
          initialPromptViaStdinPipe: true,
          extraEnv: { PLUGINS: 'all' },
        }),
    },
    mcp: ampMcpAdapter(),
    plugins: createFileDropPlugin({ relativePath: AMP_PLUGIN_PATH, content: AMP_PLUGIN_CONTENT }),
  }`,
    extraImports: `import { AMP_PLUGIN_CONTENT } from './plugin-file';\nimport { ampMcpAdapter, buildStandardCommand, createFileDropPlugin } from '@emdash/shared/agents/plugins/helpers';\n\nconst AMP_PLUGIN_PATH = '.amp/plugins/emdash-hook.ts';`,
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    description:
      'Google Antigravity CLI for terminal-first agent sessions with shared Antigravity settings and conversation history.',
    websiteUrl: 'https://antigravity.google/docs/cli-overview',
    autoApprove: { kind: 'supported' },
    effort: { kind: 'none' },
    hooks: { kind: 'none' },
    hostDependency: {
      binaryNames: ['agy', 'antigravity'],
      installCommands: {
        macos: [
          {
            method: 'curl',
            command: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
          },
        ],
        linux: [
          {
            method: 'curl',
            command: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'none' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'none' },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'resumable' },
    prompt: { kind: 'argv', flag: '-i' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          autoApproveFlag: '--dangerously-skip-permissions',
          initialPromptFlag: '-i',
          sessionIdFlag: '--conversation=',
          sessionIdAlways: true,
        }),
    },
  }`,
    extraImports: `import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';`,
  },
  {
    id: 'auggie',
    name: 'Auggie',
    description:
      'Augment Code CLI to run an agent against your repository for code changes and reviews.',
    websiteUrl: 'https://docs.augmentcode.com/cli/overview',
    autoApprove: { kind: 'none' },
    effort: { kind: 'none' },
    hooks: { kind: 'none' },
    hostDependency: {
      binaryNames: ['auggie'],
      installCommands: {
        macos: [{ method: 'npm', command: 'npm install -g @augmentcode/auggie' }],
        linux: [{ method: 'npm', command: 'npm install -g @augmentcode/auggie' }],
        windows: [{ method: 'npm', command: 'npm install -g @augmentcode/auggie' }],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'npm', package: '@augmentcode/auggie' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'none' },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'resumable' },
    prompt: { kind: 'argv', flag: '' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          defaultArgs: ['--allow-indexing'],
          initialPromptFlag: '',
          resumeFlag: '--continue',
        }),
    },
  }`,
    extraImports: `import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';`,
  },
  {
    id: 'autohand',
    name: 'Autohand Code',
    description:
      'Terminal coding agent with auto-commit, dry-run previews, community skills, and headless automation modes.',
    websiteUrl: 'https://autohand.ai/code/',
    autoApprove: { kind: 'supported' },
    effort: { kind: 'none' },
    hooks: { kind: 'none' },
    hostDependency: {
      binaryNames: ['autohand'],
      installCommands: {
        macos: [{ method: 'npm', command: 'npm install -g autohand-cli' }],
        linux: [{ method: 'npm', command: 'npm install -g autohand-cli' }],
        windows: [{ method: 'npm', command: 'npm install -g autohand-cli' }],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'npm', package: 'autohand-cli' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'none' },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'stateless' },
    prompt: { kind: 'argv', flag: '-p' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          autoApproveFlag: '--unrestricted',
          initialPromptFlag: '-p',
        }),
    },
  }`,
    extraImports: `import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';`,
  },
  {
    id: 'charm',
    name: 'Charm',
    description: 'Charm Crush agent CLI providing terminal-first AI assistance for coding tasks.',
    websiteUrl: 'https://github.com/charmbracelet/crush',
    autoApprove: { kind: 'supported' },
    effort: { kind: 'none' },
    hooks: { kind: 'none' },
    hostDependency: {
      binaryNames: ['crush'],
      installCommands: {
        macos: [{ method: 'npm', command: 'npm install -g @charmland/crush' }],
        linux: [{ method: 'npm', command: 'npm install -g @charmland/crush' }],
        windows: [{ method: 'npm', command: 'npm install -g @charmland/crush' }],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'npm', package: '@charmland/crush' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'none' },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'stateless' },
    prompt: { kind: 'argv', flag: '' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          autoApproveFlag: '--yolo',
        }),
    },
  }`,
    extraImports: `import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';`,
  },
  {
    id: 'claude',
    name: 'Claude Code',
    description:
      'CLI that uses Anthropic Claude for code edits, explanations, and structured refactors in the terminal.',
    websiteUrl: 'https://code.claude.com/docs/en/quickstart',
    autoApprove: { kind: 'supported' },
    effort: { kind: 'none' },
    hooks: { kind: 'config', scope: 'workspace', supportedEvents: ['notification', 'stop'] },
    hostDependency: {
      binaryNames: ['claude'],
      installCommands: {
        macos: [
          {
            method: 'curl',
            command: 'curl -fsSL https://claude.ai/install.sh | bash',
            recommended: true,
          },
          { method: 'homebrew', command: 'brew install --cask claude-code' },
        ],
        linux: [{ method: 'curl', command: 'curl -fsSL https://claude.ai/install.sh | bash' }],
        windows: [
          {
            method: 'curl',
            command:
              'curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'github', repo: 'anthropics/claude-code' },
        update: { kind: 'cli', args: ['update'] },
      },
    },
    mcp: { kind: 'supported', scope: 'global', supportedTransports: ['stdio', 'http'] },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'resumable' },
    prompt: { kind: 'argv', flag: '' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          autoApproveFlag: '--dangerously-skip-permissions',
          initialPromptFlag: '',
          resumeFlag: '--resume',
          sessionIdFlag: '--session-id',
        }),
    },
    hooks: buildClaudeHookConfig(),
    mcp: passthroughMcpAdapter('.claude.json'),
  }`,
    extraImports: `import { buildStandardCommand, passthroughMcpAdapter } from '@emdash/shared/agents/plugins/helpers';\nimport { buildClaudeHookConfig } from './hooks';`,
  },
  {
    id: 'cline',
    name: 'Cline',
    description:
      'Cline CLI runs coding agents directly in your terminal with multi-provider model support.',
    websiteUrl: 'https://docs.cline.bot/cline-cli/overview',
    autoApprove: { kind: 'supported' },
    effort: { kind: 'none' },
    hooks: { kind: 'none' },
    hostDependency: {
      binaryNames: ['cline'],
      installCommands: {
        macos: [{ method: 'npm', command: 'npm install -g cline' }],
        linux: [{ method: 'npm', command: 'npm install -g cline' }],
        windows: [{ method: 'npm', command: 'npm install -g cline' }],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'npm', package: 'cline' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'none' },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'stateless' },
    prompt: { kind: 'argv', flag: '' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          autoApproveFlag: '--yolo',
          initialPromptFlag: '',
        }),
    },
  }`,
    extraImports: `import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';`,
  },
  {
    id: 'codebuff',
    name: 'Codebuff',
    description:
      'Codebuff is an AI coding agent for project-directory assistance and day-to-day development tasks.',
    websiteUrl: 'https://www.codebuff.com/docs/help/quick-start',
    autoApprove: { kind: 'none' },
    effort: { kind: 'none' },
    hooks: { kind: 'none' },
    hostDependency: {
      binaryNames: ['codebuff'],
      installCommands: {
        macos: [{ method: 'npm', command: 'npm install -g codebuff' }],
        linux: [{ method: 'npm', command: 'npm install -g codebuff' }],
        windows: [{ method: 'npm', command: 'npm install -g codebuff' }],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'npm', package: 'codebuff' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'none' },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'stateless' },
    prompt: { kind: 'argv', flag: '' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          initialPromptFlag: '',
        }),
    },
  }`,
    extraImports: `import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';`,
  },
  {
    id: 'codex',
    name: 'Codex',
    description:
      'CLI that connects to OpenAI models for project-aware code assistance and terminal workflows.',
    websiteUrl: 'https://github.com/openai/codex',
    autoApprove: { kind: 'supported' },
    effort: { kind: 'none' },
    hooks: {
      kind: 'config',
      scope: 'global',
      supportedEvents: ['notification', 'stop', 'session'],
    },
    hostDependency: {
      binaryNames: ['codex'],
      installCommands: {
        macos: [
          { method: 'npm', command: 'npm install -g @openai/codex' },
          {
            method: 'homebrew',
            command: 'brew install --cask codex',
            updateCommand: 'brew upgrade --cask codex',
          },
        ],
        linux: [
          { method: 'npm', command: 'npm install -g @openai/codex' },
          {
            method: 'homebrew',
            command: 'brew install --cask codex',
            updateCommand: 'brew upgrade --cask codex',
          },
        ],
        windows: [
          { method: 'npm', command: 'npm install -g @openai/codex' },
          {
            method: 'powershell',
            command:
              'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"',
            updateCommand:
              'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'npm', package: '@openai/codex' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'supported', scope: 'global', supportedTransports: ['stdio'] },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'resumable' },
    prompt: { kind: 'argv', flag: '' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          autoApproveFlag: '-c approval_policy="never" -c sandbox_mode="danger-full-access" --dangerously-bypass-hook-trust',
          initialPromptFlag: '',
          resumeFlag: 'resume',
          sessionIdFlag: ' ',
          sessionIdOnResumeOnly: true,
          resumeWithoutSessionFlag: 'resume --last',
          deduplicateFlags: ['--dangerously-bypass-approvals-and-sandbox'],
        }),
    },
    hooks: buildCodexHookConfig(),
    mcp: codexMcpAdapter(),
  }`,
    extraImports: `import { buildStandardCommand, codexMcpAdapter } from '@emdash/shared/agents/plugins/helpers';\nimport { buildCodexHookConfig } from './hooks';`,
  },
  {
    id: 'commandcode',
    name: 'Command Code',
    description:
      'Command Code CLI for terminal-first coding sessions that learn project and personal coding taste.',
    websiteUrl: 'https://commandcode.ai/docs/reference/cli',
    autoApprove: { kind: 'supported' },
    effort: { kind: 'none' },
    hooks: { kind: 'none' },
    hostDependency: {
      binaryNames: ['command-code'],
      installCommands: {
        macos: [{ method: 'npm', command: 'npm install -g command-code@latest' }],
        linux: [{ method: 'npm', command: 'npm install -g command-code@latest' }],
        windows: [{ method: 'npm', command: 'npm install -g command-code@latest' }],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'npm', package: 'command-code' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'none' },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'resumable' },
    prompt: { kind: 'argv', flag: '' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          defaultArgs: ['--trust', '--skip-onboarding'],
          autoApproveFlag: '--yolo',
          initialPromptFlag: '',
          resumeFlag: '--continue',
        }),
    },
  }`,
    extraImports: `import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';`,
  },
  {
    id: 'continue',
    name: 'Continue',
    description:
      'Continue CLI is a modular coding agent with configurable models, rules, and MCP tool support.',
    websiteUrl: 'https://docs.continue.dev/guides/cli',
    autoApprove: { kind: 'supported' },
    effort: { kind: 'none' },
    hooks: { kind: 'none' },
    hostDependency: {
      binaryNames: ['cn'],
      installCommands: {
        macos: [{ method: 'npm', command: 'npm i -g @continuedev/cli' }],
        linux: [{ method: 'npm', command: 'npm i -g @continuedev/cli' }],
        windows: [{ method: 'npm', command: 'npm i -g @continuedev/cli' }],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'npm', package: '@continuedev/cli' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'none' },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'resumable' },
    prompt: { kind: 'argv', flag: '' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          autoApproveFlag: '--auto',
          initialPromptFlag: '',
          resumeFlag: '--resume',
        }),
    },
  }`,
    extraImports: `import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';`,
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    description:
      'GitHub Copilot CLI brings Copilot prompts to the terminal for code, shell, and search help.',
    websiteUrl: 'https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli',
    autoApprove: { kind: 'supported' },
    effort: { kind: 'none' },
    hooks: {
      kind: 'config',
      scope: 'workspace',
      supportedEvents: ['stop', 'session', 'notification'],
    },
    hostDependency: {
      binaryNames: ['copilot'],
      installCommands: {
        macos: [{ method: 'npm', command: 'npm install -g @github/copilot' }],
        linux: [{ method: 'npm', command: 'npm install -g @github/copilot' }],
        windows: [{ method: 'npm', command: 'npm install -g @github/copilot' }],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'npm', package: '@github/copilot' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'supported', scope: 'global', supportedTransports: ['stdio', 'http'] },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'resumable' },
    prompt: { kind: 'argv', flag: '-i' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          autoApproveFlag: '--allow-all-tools',
          initialPromptFlag: '-i',
          resumeFlag: '--resume',
          sessionIdFlag: '--resume',
          sessionIdOnResumeOnly: true,
        }),
    },
    hooks: buildCopilotHookConfig(),
    mcp: copilotMcpAdapter(),
  }`,
    extraImports: `import { buildStandardCommand, copilotMcpAdapter } from '@emdash/shared/agents/plugins/helpers';\nimport { buildCopilotHookConfig } from './hooks';`,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    description:
      "Cursor's agent CLI; provides editor-style, project-aware assistance from the shell.",
    websiteUrl: 'https://cursor.com/docs/cli/overview',
    autoApprove: { kind: 'supported' },
    effort: { kind: 'none' },
    hooks: { kind: 'none' },
    hostDependency: {
      binaryNames: ['cursor-agent'],
      installCommands: {
        macos: [{ method: 'curl', command: 'curl https://cursor.com/install -fsS | bash' }],
        linux: [{ method: 'curl', command: 'curl https://cursor.com/install -fsS | bash' }],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'none' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'supported', scope: 'global', supportedTransports: ['stdio', 'http'] },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'resumable' },
    prompt: { kind: 'argv', flag: '' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          autoApproveFlag: '-f --approve-mcps',
          initialPromptFlag: '',
          resumeFlag: '--resume',
        }),
    },
    mcp: cursorMcpAdapter(),
  }`,
    extraImports: `import { buildStandardCommand, cursorMcpAdapter } from '@emdash/shared/agents/plugins/helpers';`,
  },
  {
    id: 'devin',
    name: 'Devin',
    description:
      "Cognition's Devin for Terminal agent for local, interactive coding sessions with Devin Cloud integration.",
    websiteUrl: 'https://docs.devin.ai/cli',
    autoApprove: { kind: 'supported' },
    effort: { kind: 'none' },
    hooks: { kind: 'config', scope: 'workspace', supportedEvents: ['stop', 'notification'] },
    hostDependency: {
      binaryNames: ['devin'],
      installCommands: {
        macos: [{ method: 'curl', command: 'curl -fsSL https://cli.devin.ai/install.sh | bash' }],
        linux: [{ method: 'curl', command: 'curl -fsSL https://cli.devin.ai/install.sh | bash' }],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'none' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'none' },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'resumable' },
    prompt: { kind: 'argv', flag: '--' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          autoApproveFlag: '--permission-mode=bypass',
          initialPromptFlag: '--',
          resumeFlag: '--continue',
        }),
    },
    hooks: buildDevinHookConfig(),
  }`,
    extraImports: `import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';\nimport { buildDevinHookConfig } from './hooks';`,
  },
  {
    id: 'droid',
    name: 'Droid',
    description: "Factory AI's agent CLI for running multi-step coding tasks from the terminal.",
    websiteUrl: 'https://docs.factory.ai/cli/getting-started/quickstart',
    autoApprove: { kind: 'none' },
    effort: { kind: 'none' },
    hooks: {
      kind: 'config',
      scope: 'workspace',
      supportedEvents: ['notification', 'stop', 'session'],
    },
    hostDependency: {
      binaryNames: ['droid'],
      installCommands: {
        macos: [{ method: 'curl', command: 'curl -fsSL https://app.factory.ai/cli | sh' }],
        linux: [{ method: 'curl', command: 'curl -fsSL https://app.factory.ai/cli | sh' }],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'none' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'supported', scope: 'global', supportedTransports: ['stdio', 'http'] },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'resumable' },
    prompt: { kind: 'argv', flag: '' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          initialPromptFlag: '',
          resumeFlag: '--resume',
          sessionIdFlag: '--resume',
          sessionIdOnResumeOnly: true,
        }),
    },
    hooks: buildDroidHookConfig(),
    mcp: droidMcpAdapter(),
  }`,
    extraImports: `import { buildStandardCommand, droidMcpAdapter } from '@emdash/shared/agents/plugins/helpers';\nimport { buildDroidHookConfig } from './hooks';`,
  },
  {
    id: 'freebuff',
    name: 'Freebuff',
    description:
      'Freebuff is a standalone Codebuff package for project-directory assistance and day-to-day development tasks.',
    websiteUrl: 'https://freebuff.com',
    autoApprove: { kind: 'none' },
    effort: { kind: 'none' },
    hooks: { kind: 'none' },
    hostDependency: {
      binaryNames: ['freebuff'],
      installCommands: {
        macos: [{ method: 'npm', command: 'npm install -g freebuff' }],
        linux: [{ method: 'npm', command: 'npm install -g freebuff' }],
        windows: [{ method: 'npm', command: 'npm install -g freebuff' }],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'npm', package: 'freebuff' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'none' },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'stateless' },
    prompt: { kind: 'argv', flag: '' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          initialPromptFlag: '',
        }),
    },
  }`,
    extraImports: `import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';`,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    description:
      'CLI that uses Google Gemini models to assist with coding, reasoning, and command-line tasks.',
    websiteUrl: 'https://github.com/google-gemini/gemini-cli',
    autoApprove: { kind: 'supported' },
    effort: { kind: 'none' },
    hooks: { kind: 'none' },
    hostDependency: {
      binaryNames: ['gemini'],
      installCommands: {
        macos: [{ method: 'npm', command: 'npm install -g @google/gemini-cli' }],
        linux: [{ method: 'npm', command: 'npm install -g @google/gemini-cli' }],
        windows: [{ method: 'npm', command: 'npm install -g @google/gemini-cli' }],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'npm', package: '@google/gemini-cli' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'supported', scope: 'global', supportedTransports: ['stdio', 'http'] },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'resumable' },
    prompt: { kind: 'argv', flag: '-i' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          autoApproveFlag: '--approval-mode=yolo --skip-trust',
          initialPromptFlag: '-i',
          resumeFlag: '--resume',
          extraEnv: ctx.autoApprove ? { GEMINI_CLI_TRUST_WORKSPACE: 'true' } : {},
        }),
    },
    mcp: geminiMcpAdapter(),
  }`,
    extraImports: `import { buildStandardCommand, geminiMcpAdapter } from '@emdash/shared/agents/plugins/helpers';`,
  },
  {
    id: 'goose',
    name: 'Goose',
    description: 'Goose CLI that routes tasks to tools and models for coding workflows.',
    websiteUrl: 'https://goose-docs.ai/docs/quickstart/',
    autoApprove: { kind: 'none' },
    effort: { kind: 'none' },
    hooks: { kind: 'none' },
    hostDependency: {
      binaryNames: ['goose'],
      installCommands: {
        macos: [
          {
            method: 'curl',
            command:
              'curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | bash',
          },
        ],
        linux: [
          {
            method: 'curl',
            command:
              'curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | bash',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'github', repo: 'aaif-goose/goose' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'none' },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'resumable' },
    prompt: { kind: 'argv', flag: '-t' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          defaultArgs: ['run', '-s'],
          initialPromptFlag: '-t',
          resumeFlag: '--resume',
        }),
    },
  }`,
    extraImports: `import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';`,
  },
  {
    id: 'grok',
    name: 'Grok',
    description:
      "xAI's Grok CLI for terminal-first coding sessions with plans, subagents, and parallel work.",
    websiteUrl: 'https://x.ai/cli',
    autoApprove: { kind: 'supported' },
    effort: { kind: 'none' },
    hooks: {
      kind: 'config',
      scope: 'global',
      supportedEvents: ['notification', 'stop', 'session', 'start'],
    },
    hostDependency: {
      binaryNames: ['grok'],
      installCommands: {
        macos: [{ method: 'curl', command: 'curl -fsSL https://x.ai/cli/install.sh | bash' }],
        linux: [{ method: 'curl', command: 'curl -fsSL https://x.ai/cli/install.sh | bash' }],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'none' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'none' },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'resumable' },
    prompt: { kind: 'keystroke' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          autoApproveFlag: '--always-approve',
          resumeFlag: '-r',
          sessionIdFlag: '-r',
          sessionIdOnResumeOnly: true,
          resumeWithoutSessionFlag: '-r',
        }),
    },
    hooks: buildGrokHookConfig(),
  }`,
    extraImports: `import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';\nimport { buildGrokHookConfig } from './hooks';`,
  },
  {
    id: 'hermes',
    name: 'Hermes Agent',
    description:
      'Nous Research terminal agent with interactive chat, model-provider routing, skills, and session workflows.',
    websiteUrl: 'https://hermes-agent.nousresearch.com/docs/',
    autoApprove: { kind: 'supported' },
    effort: { kind: 'none' },
    hooks: { kind: 'none' },
    hostDependency: {
      binaryNames: ['hermes'],
      installCommands: {
        macos: [
          {
            method: 'curl',
            command: 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash',
          },
        ],
        linux: [
          {
            method: 'curl',
            command: 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'none' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'none' },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'resumable' },
    prompt: { kind: 'keystroke' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          autoApproveFlag: '--yolo',
          resumeFlag: '--continue',
        }),
    },
  }`,
    extraImports: `import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';`,
  },
  {
    id: 'jules',
    name: 'Jules',
    description:
      "Google's Jules CLI for managing asynchronous remote coding sessions and a terminal dashboard.",
    websiteUrl: 'https://jules.google/docs/cli/reference/',
    autoApprove: { kind: 'none' },
    effort: { kind: 'none' },
    hooks: { kind: 'none' },
    hostDependency: {
      binaryNames: ['jules'],
      installCommands: {
        macos: [{ method: 'npm', command: 'npm install -g @google/jules' }],
        linux: [{ method: 'npm', command: 'npm install -g @google/jules' }],
        windows: [{ method: 'npm', command: 'npm install -g @google/jules' }],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'npm', package: '@google/jules' },
        update: { kind: 'package-manager' },
      },
    },
    versionArgs: ['version'],
    mcp: { kind: 'none' },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'stateless' },
    prompt: { kind: 'keystroke' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          initialPromptFlag: '',
        }),
    },
  }`,
    extraImports: `import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';`,
  },
  {
    id: 'junie',
    name: 'Junie',
    description:
      'JetBrains agentic coding CLI for interactive terminal and headless project workflows.',
    websiteUrl: 'https://junie.jetbrains.com/docs/junie-cli.html',
    autoApprove: { kind: 'none' },
    effort: { kind: 'none' },
    hooks: { kind: 'none' },
    hostDependency: {
      binaryNames: ['junie'],
      installCommands: {
        macos: [
          { method: 'curl', command: 'curl -fsSL https://junie.jetbrains.com/install.sh | bash' },
        ],
        linux: [
          { method: 'curl', command: 'curl -fsSL https://junie.jetbrains.com/install.sh | bash' },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'none' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'none' },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'resumable' },
    prompt: { kind: 'argv', flag: '--task' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          initialPromptFlag: '--task',
          sessionIdFlag: '--session-id',
        }),
    },
  }`,
    extraImports: `import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';`,
  },
  {
    id: 'kilocode',
    name: 'Kilocode',
    description:
      'Kilo AI coding assistant with multiple modes, broad model support, and checkpoint-based workflows.',
    websiteUrl: 'https://kilo.ai/docs/cli',
    autoApprove: { kind: 'supported' },
    effort: { kind: 'none' },
    hooks: { kind: 'none' },
    hostDependency: {
      binaryNames: ['kilo'],
      installCommands: {
        macos: [{ method: 'npm', command: 'npm install -g @kilocode/cli' }],
        linux: [{ method: 'npm', command: 'npm install -g @kilocode/cli' }],
        windows: [{ method: 'npm', command: 'npm install -g @kilocode/cli' }],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'npm', package: '@kilocode/cli' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'none' },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'resumable' },
    prompt: { kind: 'argv', flag: '' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          autoApproveFlag: '--auto',
          initialPromptFlag: '',
          resumeFlag: '--continue',
        }),
    },
  }`,
    extraImports: `import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';`,
  },
  {
    id: 'kimi',
    name: 'Kimi',
    description:
      'Kimi CLI by Moonshot AI, with shell execution, Zsh integration, ACP, and MCP support.',
    websiteUrl: 'https://moonshotai.github.io/kimi-cli/en/guides/getting-started.html',
    autoApprove: { kind: 'supported' },
    effort: { kind: 'none' },
    hooks: {
      kind: 'config',
      scope: 'global',
      supportedEvents: ['notification', 'stop', 'session', 'start'],
    },
    hostDependency: {
      binaryNames: ['kimi'],
      installCommands: {
        macos: [{ method: 'curl', command: 'curl -LsSf https://code.kimi.com/install.sh | bash' }],
        linux: [{ method: 'curl', command: 'curl -LsSf https://code.kimi.com/install.sh | bash' }],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'github', repo: 'moonshotai/kimi-cli' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'none' },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'resumable' },
    prompt: { kind: 'keystroke' },
    provider: `{
    prompt: {
      buildCommand: buildKimiCommand,
    },
    hooks: buildKimiHookConfig(),
    sessions: {
      validateSessionId: undefined,
    },
  }`,
    extraImports: `import type { AgentCommand, CommandContext } from '@emdash/shared/agents/plugins';
import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';
import { addKimiHooksToConfigText, buildKimiHookConfig } from './hooks';

function injectKimiHooksIntoInlineConfig(args: string[]): string[] {
  return args.map((arg, index) => {
    if (arg === '--config' && args[index + 1] !== undefined) return arg;
    if (index > 0 && args[index - 1] === '--config') return addKimiHooksToConfigText(arg);
    if (arg.startsWith('--config=')) return \`--config=\${addKimiHooksToConfigText(arg.slice('--config='.length))}\`;
    return arg;
  });
}

function buildKimiCommand(ctx: CommandContext): AgentCommand {
  const cmd = buildStandardCommand(ctx, {
    autoApproveFlag: '--yolo',
    resumeFlag: '-S',
    sessionIdFlag: '-S',
    sessionIdOnResumeOnly: true,
    resumeWithoutSessionFlag: '-C',
    omitAutoApproveOnResume: true,
  });
  return { ...cmd, args: injectKimiHooksIntoInlineConfig(cmd.args) };
}`,
  },
  {
    id: 'kiro',
    name: 'Kiro (AWS)',
    description:
      'Kiro CLI by AWS, focused on interactive terminal-first development assistance and workflow automation.',
    websiteUrl: 'https://kiro.dev/docs/cli/',
    autoApprove: { kind: 'supported' },
    effort: { kind: 'none' },
    hooks: { kind: 'config', scope: 'workspace', supportedEvents: ['session', 'start', 'stop'] },
    hostDependency: {
      binaryNames: ['kiro-cli'],
      installCommands: {
        macos: [{ method: 'curl', command: 'curl -fsSL https://cli.kiro.dev/install | bash' }],
        linux: [{ method: 'curl', command: 'curl -fsSL https://cli.kiro.dev/install | bash' }],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'none' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'none' },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'resumable' },
    prompt: { kind: 'argv', flag: '' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          defaultArgs: ['chat', '--agent', 'emdash'],
          autoApproveFlag: '--trust-all-tools',
          initialPromptFlag: '',
          resumeFlag: '--resume-id',
          sessionIdFlag: '--resume-id',
          sessionIdOnResumeOnly: true,
          resumeWithoutSessionFlag: '--resume',
        }),
    },
    hooks: buildKiroHookConfig(),
  }`,
    extraImports: `import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';\nimport { buildKiroHookConfig } from './hooks';`,
  },
  {
    id: 'letta',
    name: 'Letta',
    description:
      'Memory-first coding agent CLI with persistent agents that learn across sessions and portable memory across models.',
    websiteUrl: 'https://docs.letta.com/letta-code/cli',
    autoApprove: { kind: 'supported' },
    effort: { kind: 'none' },
    hooks: { kind: 'none' },
    hostDependency: {
      binaryNames: ['letta'],
      skipVersionProbe: true,
      installCommands: {
        macos: [{ method: 'npm', command: 'npm install -g @letta-ai/letta-code' }],
        linux: [{ method: 'npm', command: 'npm install -g @letta-ai/letta-code' }],
        windows: [{ method: 'npm', command: 'npm install -g @letta-ai/letta-code' }],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'npm', package: '@letta-ai/letta-code' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'none' },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'resumable' },
    prompt: { kind: 'keystroke' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          autoApproveFlag: '--yolo',
          newConversationFlag: '--new',
        }),
    },
  }`,
    extraImports: `import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';`,
  },
  {
    id: 'mistral',
    name: 'Mistral Vibe',
    description:
      'Mistral AI terminal coding assistant with conversational codebase help, execution tools, and file operations.',
    websiteUrl: 'https://github.com/mistralai/mistral-vibe',
    autoApprove: { kind: 'supported' },
    effort: { kind: 'none' },
    hooks: { kind: 'none' },
    hostDependency: {
      binaryNames: ['vibe'],
      installCommands: {
        macos: [
          { method: 'curl', command: 'curl -LsSf https://mistral.ai/vibe/install.sh | bash' },
        ],
        linux: [
          { method: 'curl', command: 'curl -LsSf https://mistral.ai/vibe/install.sh | bash' },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'github', repo: 'mistralai/mistral-vibe' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'none' },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'stateless' },
    prompt: { kind: 'argv', flag: '' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          autoApproveFlag: '--agent auto-approve',
          initialPromptFlag: '',
        }),
    },
  }`,
    extraImports: `import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';`,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    description:
      'OpenCode CLI that interfaces with models for code generation and edits from the shell.',
    websiteUrl: 'https://opencode.ai/docs/cli/',
    autoApprove: { kind: 'supported' },
    effort: { kind: 'none' },
    hooks: {
      kind: 'plugin',
      scope: 'workspace',
      supportedEvents: ['notification', 'stop', 'session'],
    },
    hostDependency: {
      binaryNames: ['opencode'],
      installCommands: {
        macos: [{ method: 'npm', command: 'npm install -g opencode-ai' }],
        linux: [{ method: 'npm', command: 'npm install -g opencode-ai' }],
        windows: [{ method: 'npm', command: 'npm install -g opencode-ai' }],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'npm', package: 'opencode-ai' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'supported', scope: 'global', supportedTransports: ['stdio', 'http'] },
    models: { kind: 'none' },
    plugins: { kind: 'file-drop', scope: 'workspace' },
    sessions: { kind: 'resumable' },
    prompt: { kind: 'argv', flag: '--prompt' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          extraEnv: ctx.autoApprove ? { OPENCODE_PERMISSION: '{"*":"allow"}' } : {},
          initialPromptFlag: '--prompt',
          resumeFlag: '--session',
          sessionIdFlag: '--session',
          sessionIdOnResumeOnly: true,
          resumeWithoutSessionFlag: '--continue',
          validateSessionId,
        }),
    },
    sessions: { validateSessionId },
    mcp: opencodeMcpAdapter(),
    plugins: createFileDropPlugin({
      relativePath: OPENCODE_PLUGIN_PATH,
      content: OPENCODE_PLUGIN_CONTENT,
    }),
  }`,
    extraImports: `import { OPENCODE_PLUGIN_CONTENT } from './plugin-file';
import { buildStandardCommand, createFileDropPlugin, opencodeMcpAdapter } from '@emdash/shared/agents/plugins/helpers';

const OPENCODE_PLUGIN_PATH = '.opencode/plugins/emdash-notifications.js';
const validateSessionId = (id: string) => id.startsWith('ses');`,
  },
  {
    id: 'pi',
    name: 'Pi',
    description:
      'Minimal terminal coding agent with multi-provider model support and extensible custom tools.',
    websiteUrl: 'https://github.com/earendil-works/pi/tree/main/packages/coding-agent',
    autoApprove: { kind: 'none' },
    effort: { kind: 'none' },
    hooks: { kind: 'plugin', scope: 'workspace', supportedEvents: ['stop'] },
    hostDependency: {
      binaryNames: ['pi'],
      installCommands: {
        macos: [
          {
            method: 'npm',
            command: 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent',
          },
        ],
        linux: [
          {
            method: 'npm',
            command: 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent',
          },
        ],
        windows: [
          {
            method: 'npm',
            command: 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'npm', package: '@earendil-works/pi-coding-agent' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'none' },
    models: { kind: 'none' },
    plugins: { kind: 'file-drop', scope: 'workspace' },
    sessions: { kind: 'resumable' },
    prompt: { kind: 'argv', flag: '' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          initialPromptFlag: '',
          resumeFlag: '-c',
        }),
    },
    plugins: createFileDropPlugin({ relativePath: PI_EXTENSION_PATH, content: PI_EXTENSION_CONTENT }),
  }`,
    extraImports: `import { PI_EXTENSION_CONTENT } from './plugin-file';
import { buildStandardCommand, createFileDropPlugin } from '@emdash/shared/agents/plugins/helpers';

const PI_EXTENSION_PATH = '.pi/extensions/emdash-hook.ts';`,
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    description:
      "Command-line interface to Alibaba's Qwen Code models for coding assistance and code completion.",
    websiteUrl: 'https://github.com/QwenLM/qwen-code',
    autoApprove: { kind: 'supported' },
    effort: { kind: 'none' },
    hooks: { kind: 'config', scope: 'workspace', supportedEvents: ['notification', 'stop'] },
    hostDependency: {
      binaryNames: ['qwen'],
      installCommands: {
        macos: [{ method: 'npm', command: 'npm install -g @qwen-code/qwen-code' }],
        linux: [{ method: 'npm', command: 'npm install -g @qwen-code/qwen-code' }],
        windows: [{ method: 'npm', command: 'npm install -g @qwen-code/qwen-code' }],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'npm', package: '@qwen-code/qwen-code' },
        update: { kind: 'package-manager' },
      },
    },
    mcp: { kind: 'supported', scope: 'global', supportedTransports: ['stdio', 'http'] },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'resumable' },
    prompt: { kind: 'argv', flag: '-i' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          autoApproveFlag: '--yolo',
          initialPromptFlag: '-i',
          resumeFlag: '--continue',
        }),
    },
    hooks: buildQwenHookConfig(),
    mcp: qwenMcpAdapter(),
  }`,
    extraImports: `import { buildStandardCommand, qwenMcpAdapter } from '@emdash/shared/agents/plugins/helpers';\nimport { buildQwenHookConfig } from './hooks';`,
  },
  {
    id: 'rovo',
    name: 'Rovo Dev',
    description:
      'Atlassian Rovo Dev CLI integrates terminal assistance with Jira, Confluence, and Bitbucket workflows.',
    websiteUrl:
      'https://support.atlassian.com/rovo/docs/install-and-run-rovo-dev-cli-on-your-device/',
    autoApprove: { kind: 'supported' },
    effort: { kind: 'none' },
    hooks: { kind: 'none' },
    hostDependency: {
      binaryNames: ['rovodev', 'acli'],
      installCommands: {
        macos: [{ method: 'other', command: 'acli rovodev auth login' }],
        linux: [{ method: 'other', command: 'acli rovodev auth login' }],
      },
      updates: { kind: 'none' },
    },
    mcp: { kind: 'none' },
    models: { kind: 'none' },
    plugins: { kind: 'none' },
    sessions: { kind: 'stateless' },
    prompt: { kind: 'argv', flag: '' },
    provider: `{
    prompt: {
      buildCommand: (ctx) =>
        buildStandardCommand(ctx, {
          autoApproveFlag: '--yolo',
        }),
    },
  }`,
    extraImports: `import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';`,
  },
];

function jsonLiteral(val, indent = 4) {
  return JSON.stringify(val, null, 2).replace(/\n/g, '\n' + ' '.repeat(indent));
}

function generateIndexTs(p) {
  const hostDep = {
    id: p.id,
    binaryNames: p.hostDependency.binaryNames,
    ...(p.hostDependency.versionArgs ? { versionArgs: p.hostDependency.versionArgs } : {}),
    ...(p.versionArgs ? { versionArgs: p.versionArgs } : {}),
    ...(p.hostDependency.skipVersionProbe ? { skipVersionProbe: true } : {}),
    installCommands: p.hostDependency.installCommands,
    ...(p.hostDependency.installDocs ? { installDocs: p.hostDependency.installDocs } : {}),
    updates: p.hostDependency.updates,
  };

  return `import { definePlugin, registerPluginBehavior } from '@emdash/shared/agents/plugins';
${p.extraImports}
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: '${p.id}',
    name: '${p.name.replace(/'/g, "\\'")}',
    description: '${p.description.replace(/'/g, "\\'")}',
    websiteUrl: '${p.websiteUrl}',
  },
  {
    autoApprove: ${jsonLiteral(p.autoApprove)},
    effort: ${jsonLiteral(p.effort)},
    hooks: ${jsonLiteral(p.hooks)},
    hostDependency: ${jsonLiteral(hostDep)},
    mcp: ${jsonLiteral(p.mcp)},
    models: ${jsonLiteral(p.models)},
    plugins: ${jsonLiteral(p.plugins)},
    prompt: ${jsonLiteral(p.prompt)},
    sessions: ${jsonLiteral(p.sessions)},
  },
  { icon }
);

export const provider = registerPluginBehavior(plugin, ${p.provider});
`;
}

let errors = 0;
for (const p of PLUGINS) {
  const path = join(IMPL_DIR, p.id, 'index.ts');
  try {
    writeFileSync(path, generateIndexTs(p));
    console.log(`✓ ${p.id}`);
  } catch (e) {
    console.error(`✗ ${p.id}: ${e.message}`);
    errors++;
  }
}
if (errors > 0) {
  process.exit(1);
} else {
  console.log('\nAll index.ts files generated!');
}
