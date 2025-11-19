import React from 'react';
import { type Provider } from '../types';
import openaiLogo from '../../assets/images/openai.png';
import claudeLogo from '../../assets/images/claude.png';
import factoryLogo from '../../assets/images/factorydroid.png';
import geminiLogo from '../../assets/images/gemini.png';
import cursorLogo from '../../assets/images/cursorlogo.png';
import copilotLogo from '../../assets/images/ghcopilot.png';
import ampLogo from '../../assets/images/ampcode.png';
import opencodeLogo from '../../assets/images/opencode.png';
import charmLogo from '../../assets/images/charm.png';
import qwenLogo from '../../assets/images/qwen.png';
import augmentLogo from '../../assets/images/augmentcode.png';
import gooseLogo from '../../assets/images/goose.png';
import kimiLogo from '../../assets/images/kimi.png';
import kiroLogo from '../../assets/images/kiro.png';
import atlassianLogo from '../../assets/images/atlassian.png';

type ProviderInfo = { name: string; logo: string; alt: string; invertInDark?: boolean };

const providerConfig: Record<Provider, ProviderInfo> = {
  codex: { name: 'Codex', logo: openaiLogo, alt: 'Codex', invertInDark: true },
  qwen: { name: 'Qwen Code', logo: qwenLogo, alt: 'Qwen Code' },
  claude: { name: 'Claude Code', logo: claudeLogo, alt: 'Claude Code' },
  droid: { name: 'Droid', logo: factoryLogo, alt: 'Factory Droid', invertInDark: true },
  gemini: { name: 'Gemini', logo: geminiLogo, alt: 'Gemini CLI' },
  cursor: { name: 'Cursor', logo: cursorLogo, alt: 'Cursor CLI', invertInDark: true },
  copilot: { name: 'Copilot', logo: copilotLogo, alt: 'GitHub Copilot CLI', invertInDark: true },
  amp: { name: 'Amp', logo: ampLogo, alt: 'Amp Code' },
  opencode: { name: 'OpenCode', logo: opencodeLogo, alt: 'OpenCode', invertInDark: true },
  charm: { name: 'Charm', logo: charmLogo, alt: 'Charm' },
  auggie: { name: 'Auggie', logo: augmentLogo, alt: 'Auggie CLI' },
  goose: { name: 'Goose', logo: gooseLogo, alt: 'Goose CLI' },
  kimi: { name: 'Kimi', logo: kimiLogo, alt: 'Kimi CLI' },
  kiro: { name: 'Kiro', logo: kiroLogo, alt: 'Kiro CLI' },
  rovo: { name: 'Rovo Dev', logo: atlassianLogo, alt: 'Rovo Dev CLI' },
};

interface MultiProviderSelectorProps {
  value: Provider[];
  onChange: (next: Provider[]) => void;
  max?: number; // limit selection
  className?: string;
}

export const MultiProviderSelector: React.FC<MultiProviderSelectorProps> = ({
  value,
  onChange,
  max = 4,
  className = '',
}) => {
  const selected = new Set(value);
  const toggle = (p: Provider) => {
    const next = new Set(selected);
    if (next.has(p)) next.delete(p);
    else {
      if (next.size >= max) return; // enforce limit
      next.add(p);
    }
    onChange(Array.from(next));
  };

  return (
    <div className={`grid grid-cols-2 gap-2 sm:grid-cols-3 ${className}`}>
      {(Object.keys(providerConfig) as Provider[]).map((id) => {
        const info = providerConfig[id];
        const active = selected.has(id);
        return (
          <button
            type="button"
            key={id}
            onClick={() => toggle(id)}
            className={[
              'flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm',
              active
                ? 'border-primary/60 bg-primary/10 text-foreground'
                : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/50',
            ].join(' ')}
            aria-pressed={active}
          >
            <img
              src={info.logo}
              alt={info.alt}
              className={`h-4 w-4 rounded-sm ${info.invertInDark ? 'dark:invert' : ''}`}
            />
            <span className="truncate">{info.name}</span>
          </button>
        );
      })}
    </div>
  );
};

export default MultiProviderSelector;
