import React from 'react';
import { type UiProvider } from '@/providers/meta';
import { providerAssets } from '@/providers/assets';

export type ProviderInfo = {
  title: string;
  description?: string;
  capabilities?: string[];
  knowledgeCutoff?: string;
  hostingNote?: string;
  image?: string; // optional override
};

// Centralized, growable provider info. Content can be curated later.
export const providerInfo: Record<UiProvider, ProviderInfo> = {
  codex: {
    title: 'Codex',
    description: 'OpenAI Codex CLI for code and terminal workflows.',
    capabilities: ['Code', 'Terminal', 'Refactor'],
  },
  claude: {
    title: 'Claude Code',
    description: 'Claude’s coding assistant CLI for structured coding tasks.',
    capabilities: ['Code', 'Explain', 'Reasoning'],
  },
  qwen: {
    title: 'Qwen Code',
    description: 'Qwen command‑line coding assistant.',
    capabilities: ['Code'],
  },
  droid: {
    title: 'Droid',
    description: 'Factory AI agent CLI.',
    capabilities: ['Code', 'Terminal'],
  },
  gemini: {
    title: 'Gemini',
    description: 'Google Gemini CLI for coding and terminal tasks.',
    capabilities: ['Code', 'Reasoning'],
  },
  cursor: {
    title: 'Cursor',
    description: 'Cursor Agent CLI integration.',
    capabilities: ['Code', 'IDE Agent'],
  },
  copilot: {
    title: 'GitHub Copilot',
    description: 'Copilot CLI for coding from the terminal.',
    capabilities: ['Code', 'Explain'],
  },
  amp: {
    title: 'Amp',
    description: 'Amp Code CLI.',
    capabilities: ['Code'],
  },
  opencode: {
    title: 'OpenCode',
    description: 'OpenCode CLI.',
    capabilities: ['Code'],
  },
  charm: {
    title: 'Charm',
    description: 'Charm Crush agent.',
    capabilities: ['Code'],
  },
  auggie: {
    title: 'Auggie',
    description: 'Augment Code CLI.',
    capabilities: ['Code'],
  },
};

type Props = {
  id: UiProvider;
};

export const ProviderInfoCard: React.FC<Props> = ({ id }) => {
  const info = providerInfo[id];
  const asset = providerAssets[id];
  const logo = asset.logo;
  return (
    <div className="w-80 max-w-[20rem] rounded-lg  bg-background p-3 text-foreground shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        {logo ? (
          <img src={logo} alt={info.title} className={`h-5 w-5 rounded-sm ${asset.invertInDark ? 'dark:invert' : ''}`} />
        ) : null}
        <div className="text-sm font-semibold leading-none">{info.title}</div>
      </div>
      {info.description ? (
        <p className="mb-2 text-xs text-muted-foreground">{info.description}</p>
      ) : null}
      {info.capabilities && info.capabilities.length > 0 ? (
        <div className="mb-2">
          <div className="mb-1 text-xs font-medium text-foreground/90">Capabilities</div>
          <div className="grid grid-cols-2 gap-1">
            {info.capabilities.map((cap) => (
              <div key={cap} className="rounded-md border px-2 py-1 text-[11px] text-foreground/90">
                {cap}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {info.knowledgeCutoff || info.hostingNote ? (
        <div className="mt-2 space-y-1">
          {info.knowledgeCutoff ? (
            <div className="text-[11px] text-muted-foreground">Knowledge cutoff: {info.knowledgeCutoff}</div>
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
