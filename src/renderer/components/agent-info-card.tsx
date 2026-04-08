import { ArrowUpRight, Check, Copy } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import {
  getDocUrlForProvider,
  getInstallCommandForProvider,
} from '@shared/agent-provider-registry';
import { agentConfig } from '@renderer/lib/agentConfig';
import { type UiAgent } from '@renderer/providers/meta';
import AgentLogo from './agent-logo';
import { Button } from './ui/button';

type AgentInfo = {
  title: string;
  description?: string;
  hostingNote?: string;
  installCommand?: string;
};

const agentInfo: Record<UiAgent, AgentInfo> = {
  codex: {
    title: 'Codex',
    description:
      'CLI that connects to OpenAI models for project-aware code assistance and terminal workflows.',
  },
  claude: {
    title: 'Claude Code',
    description:
      'CLI that uses Anthropic Claude for code edits, explanations, and structured refactors in the terminal.',
  },
  qwen: {
    title: 'Qwen Code',
    description:
      "Command-line interface to Alibaba's Qwen Code models for coding assistance and code completion.",
  },
  droid: {
    title: 'Droid',
    description: "Factory AI's agent CLI for running multi-step coding tasks from the terminal.",
  },
  gemini: {
    title: 'Gemini',
    description:
      'CLI that uses Google Gemini models to assist with coding, reasoning, and command-line tasks.',
  },
  cursor: {
    title: 'Cursor',
    description:
      "Cursor's agent CLI; provides editor-style, project-aware assistance from the shell.",
  },
  copilot: {
    title: 'GitHub Copilot',
    description:
      'GitHub Copilot CLI brings Copilot prompts to the terminal for code, shell, and search help.',
  },
  amp: {
    title: 'Amp',
    description:
      'Amp Code CLI for agentic coding sessions against your repository from the terminal.',
  },
  opencode: {
    title: 'OpenCode',
    description:
      'OpenCode CLI that interfaces with models for code generation and edits from the shell.',
  },
  charm: {
    title: 'Charm',
    description: 'Charm Crush agent CLI providing terminal-first AI assistance for coding tasks.',
  },
  auggie: {
    title: 'Auggie',
    description:
      'Augment Code CLI to run an agent against your repository for code changes and reviews.',
  },
  goose: {
    title: 'Goose',
    description: 'Goose CLI that routes tasks to tools and models for coding workflows.',
  },
  kimi: {
    title: 'Kimi',
    description:
      'Kimi CLI by Moonshot AI, with shell execution, Zsh integration, ACP, and MCP support.',
    hostingNote:
      'macOS/Linux only; first run on macOS may take a few seconds due to security checks.',
  },
  kilocode: {
    title: 'Kilocode',
    description:
      'Kilo AI coding assistant with multiple modes, broad model support, and checkpoint-based workflows.',
  },
  kiro: {
    title: 'Kiro',
    description:
      'Kiro CLI by AWS, focused on interactive terminal-first development assistance and workflow automation.',
  },
  rovo: {
    title: 'Rovo Dev',
    description:
      'Atlassian Rovo Dev CLI integrates terminal assistance with Jira, Confluence, and Bitbucket workflows.',
  },
  cline: {
    title: 'Cline',
    description:
      'Cline CLI runs coding agents directly in your terminal with multi-provider model support.',
  },
  continue: {
    title: 'Continue',
    description:
      'Continue CLI is a modular coding agent with configurable models, rules, and MCP tool support.',
  },
  codebuff: {
    title: 'Codebuff',
    description:
      'Codebuff is an AI coding agent for project-directory assistance and day-to-day development tasks.',
  },
  mistral: {
    title: 'Mistral Vibe',
    description:
      'Mistral AI terminal coding assistant with conversational codebase help, execution tools, and file operations.',
  },
  pi: {
    title: 'Pi',
    description:
      'Minimal terminal coding agent with multi-provider model support and extensible custom tools.',
  },
  autohand: {
    title: 'Autohand Code',
    description:
      'Terminal coding agent with auto-commit, dry-run previews, community skills, and headless automation modes.',
  },
};

type Props = {
  id: UiAgent;
};

export const AgentInfoCard: React.FC<Props> = ({ id }) => {
  const info = agentInfo[id];
  const config = agentConfig[id];
  const installCommand =
    info.installCommand ?? getInstallCommandForProvider(id) ?? 'npm install -g @openai/codex';
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetRef.current !== null) {
        window.clearTimeout(copyResetRef.current);
      }
    };
  }, []);

  const handleCopyClick = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(installCommand);
      setCopied(true);
      if (copyResetRef.current !== null) {
        window.clearTimeout(copyResetRef.current);
      }
      copyResetRef.current = window.setTimeout(() => {
        setCopied(false);
        copyResetRef.current = null;
      }, 2000);
    } catch (error) {
      console.error('Failed to copy install command', error);
      setCopied(false);
    }
  };

  const CopyIndicatorIcon = copied ? Check : Copy;

  return (
    <div className="w-80 max-w-[20rem] rounded-lg border border-border bg-background p-3 text-foreground shadow-md">
      <div className="mb-2 flex items-center gap-2">
        <AgentLogo
          logo={config.logo}
          alt={config.alt}
          isSvg={config.isSvg}
          invertInDark={config.invertInDark}
          className="h-5 w-5 rounded-sm"
        />
        <div className="flex items-baseline gap-1 text-sm leading-none">
          <span className="text-foreground-muted">{config.name}</span>
          <span className="text-foreground-muted">/</span>
          <strong className="font-medium text-foreground">{info.title}</strong>
        </div>
      </div>

      {info.description ? (
        <p className="mb-2 text-xs leading-relaxed text-foreground-muted">{info.description}</p>
      ) : null}

      {getDocUrlForProvider(id) ? (
        <div className="mb-2">
          <a
            href={getDocUrlForProvider(id) ?? ''}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-background-1"
          >
            <span>Docs</span>
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      ) : null}

      <div className="mb-2">
        <a
          href="https://artificialanalysis.ai/insights/coding-agents-comparison"
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-background-1"
        >
          <span>Compare agents</span>
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>

      <div className="mb-2 flex h-8 items-center justify-between rounded-md border border-border px-2 text-xs text-foreground">
        <code className="max-w-[calc(100%-2.5rem)] truncate font-mono leading-none">
          {installCommand}
        </code>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            void handleCopyClick();
          }}
          className="ml-2 text-foreground-muted"
          aria-label={`Copy install command for ${info.title}`}
          title={copied ? 'Copied' : 'Copy command'}
        >
          <CopyIndicatorIcon className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>

      {info.hostingNote ? (
        <div className="text-xs leading-relaxed text-foreground-muted">{info.hostingNote}</div>
      ) : null}
    </div>
  );
};

export default AgentInfoCard;
