import React from 'react';
import { type UiProvider, providerMeta } from '@/providers/meta';
import { providerAssets } from '@/providers/assets';
import { ArrowUpRight } from 'lucide-react';

export type ProviderInfo = {
  title: string;
  description?: string;
  knowledgeCutoff?: string;
  hostingNote?: string;
  image?: string;
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
};

type Props = {
  id: UiProvider;
};

export const ProviderInfoCard: React.FC<Props> = ({ id }) => {
  const info = providerInfo[id];
  const asset = providerAssets[id];
  const logo = asset.logo;
  const brand = asset.name;
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
      {providerMeta[id]?.helpUrl ? (
        <div className="mb-2">
          <a
            href={providerMeta[id].helpUrl}
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
          <span>Compare Coding Agents</span>
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
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
