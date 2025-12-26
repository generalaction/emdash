import React, { useEffect, useRef, useState } from 'react';
import { type UiProvider } from '@/providers/meta';
import { providerAssets } from '@/providers/assets';
import { ArrowUpRight, Check, Copy } from 'lucide-react';
import { getDocUrlForProvider, getInstallCommandForProvider } from '@shared/providers/registry';

export type ProviderInfo = {
  title: string;
  description?: string;
  knowledgeCutoff?: string;
  hostingNote?: string;
  image?: string;
  installCommand?: string;
};

export const providerInfo: Record<UiProvider, ProviderInfo> = {
  codex: {
    title: 'Codex',
    description:
      'CLI that connects to OpenAI models for project‑aware code assistance and terminal workflows.',
  },
  claude: {
    title: 'Claude Code',
    description:
      'CLI that uses Anthropic Claude for code edits, explanations, and structured refactors in the terminal.',
  },
  qwen: {
    title: 'Qwen Code',
    description:
      'Command‑line interface to Alibaba’s Qwen Code models for coding assistance and code completion.',
  },
  droid: {
    title: 'Droid',
    description: 'Factory AI’s agent CLI for running multi‑step coding tasks from the terminal.',
  },
  gemini: {
    title: 'Gemini',
    description:
      'CLI that uses Google Gemini models to assist with coding, reasoning, and command‑line tasks.',
  },
  cursor: {
    title: 'Cursor',
    description:
      'Cursor’s agent CLI; provides editor‑style, project‑aware assistance from the shell.',
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
    description: 'Charm Crush agent CLI providing terminal‑first AI assistance for coding tasks.',
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
      'Kimi CLI by Moonshot AI — a shell-like coding agent with raw shell execution, Zsh integration, ACP and MCP support (technical preview).',
    hostingNote: 'macOS/Linux only; first run on macOS may take ~10s due to security checks.',
  },
  kilocode: {
    title: 'Kilocode',
    description:
      'Kilo AI coding assistant with multiple modes (architect, code, debug, ask, orchestrator). Supports hundreds of models with bring-your-own-keys for OpenRouter and AI gateways. Features keyboard-first navigation and checkpoint management.',
  },
  kiro: {
    title: 'Kiro',
    description:
      'Kiro CLI by Amazon Web Services — interactive, terminal-first AI development assistant with MCP integrations and workflow automation.',
  },
  rovo: {
    title: 'Rovo Dev',
    description:
      "Atlassian's Rovo Dev CLI brings an AI assistant to your terminal, integrated with Jira, Confluence, and Bitbucket via the Atlassian Command Line Interface (ACLI).",
  },
  cline: {
    title: 'Cline',
    description:
      'Cline CLI runs AI coding agents directly in your terminal. Supports multiple model providers, runs multiple instances simultaneously for parallel development, and integrates into existing shell workflows.',
  },
  codebuff: {
    title: 'Codebuff',
    description:
      'Codebuff is an AI coding agent that helps you with coding tasks. Install globally and start using it in your project directory to get AI-powered coding assistance.',
  },
  mistral: {
    title: 'Mistral Vibe',
    description:
      'Mistral AI command-line coding assistant powered by Devstral. Provides conversational interface to your codebase with file manipulation, code search, version control, and execution tools.',
  },
};

type Props = {
  id: UiProvider;
};

export const ProviderInfoCard: React.FC<Props> = ({ id }) => {
  const info = providerInfo[id];
  const asset = providerAssets[id];
  const logo = asset.logo;
  const brand = asset.name;
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
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }
    const { clipboard } = navigator;
    if (typeof clipboard.writeText !== 'function') {
      return;
    }
    try {
      await clipboard.writeText(installCommand);
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
    <div className="w-80 max-w-[20rem] rounded-lg bg-background p-3 text-foreground shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        {logo ? (
          <img
            src={logo}
            alt={brand}
            className={`h-5 w-5 rounded-sm ${asset.invertInDark ? 'dark:invert' : ''}`}
          />
        ) : null}
        <div className="flex items-baseline gap-1 text-sm leading-none">
          <span className="text-muted-foreground">{brand}</span>
          <span className="text-muted-foreground">/</span>
          <strong className="font-semibold text-foreground">{info.title}</strong>
        </div>
      </div>
      {info.description ? (
        <p className="mb-2 text-xs text-muted-foreground">{info.description}</p>
      ) : null}
      {getDocUrlForProvider(id) ? (
        <div className="mb-2">
          <a
            href={getDocUrlForProvider(id) ?? ''}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-foreground hover:underline"
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
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-foreground hover:underline"
        >
          <span>Compare agents</span>
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>
      <div className="mb-2 flex h-7 items-center justify-between rounded-md border px-2 text-xs text-foreground">
        <code className="max-w-[calc(100%-2.5rem)] truncate font-mono text-[11px] leading-none">
          {installCommand}
        </code>
        <button
          type="button"
          onClick={() => {
            void handleCopyClick();
          }}
          className="ml-2 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          aria-label={`Copy install command for ${info.title}`}
          title={copied ? 'Copied' : 'Copy command'}
        >
          <CopyIndicatorIcon className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      {info.knowledgeCutoff || info.hostingNote ? (
        <div className="mt-2 space-y-1">
          {info.knowledgeCutoff ? (
            <div className="text-[11px] text-muted-foreground">
              Knowledge cutoff: {info.knowledgeCutoff}
            </div>
          ) : null}
          {info.hostingNote ? (
            <div className="text-[11px] text-muted-foreground">{info.hostingNote}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default ProviderInfoCard;
