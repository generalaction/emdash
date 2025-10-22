import React, { useState } from 'react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectItemText,
} from './ui/select';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { ProviderInfoCard } from './ProviderInfoCard';
import type { UiProvider } from '@/providers/meta';
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

interface ProviderSelectorProps {
  value: Provider;
  onChange: (provider: Provider) => void;
  disabled?: boolean;
  className?: string;
}

const providerConfig = {
  codex: {
    name: 'Codex',
    logo: openaiLogo,
    alt: 'Codex',
    invertInDark: true,
  },
  qwen: {
    name: 'Qwen Code',
    logo: qwenLogo,
    alt: 'Qwen Code CLI',
    invertInDark: false,
  },
  claude: {
    name: 'Claude Code',
    logo: claudeLogo,
    alt: 'Claude Code',
    invertInDark: false,
  },
  droid: {
    name: 'Droid',
    logo: factoryLogo,
    alt: 'Factory Droid',
    invertInDark: true,
  },
  gemini: {
    name: 'Gemini',
    logo: geminiLogo,
    alt: 'Gemini CLI',
    invertInDark: false,
  },
  cursor: {
    name: 'Cursor',
    logo: cursorLogo,
    alt: 'Cursor CLI',
    invertInDark: true,
  },
  copilot: {
    name: 'Copilot',
    logo: copilotLogo,
    alt: 'GitHub Copilot CLI',
    invertInDark: true,
  },
  amp: {
    name: 'Amp',
    logo: ampLogo,
    alt: 'Amp CLI',
    invertInDark: false,
  },
  opencode: {
    name: 'OpenCode',
    logo: opencodeLogo,
    alt: 'OpenCode CLI',
    invertInDark: true,
  },
  charm: {
    name: 'Charm',
    logo: charmLogo,
    alt: 'Charm CLI',
    invertInDark: false,
  },
  auggie: {
    name: 'Auggie',
    logo: augmentLogo,
    alt: 'Auggie CLI',
    invertInDark: false,
  },
} as const;

export const ProviderSelector: React.FC<ProviderSelectorProps> = ({
  value,
  onChange,
  disabled = false,
  className = '',
}) => {
  const currentProvider = providerConfig[value];

  return (
    <div className={`relative block w-[12rem] min-w-0 ${className}`}>
      <Select
        value={value}
        onValueChange={(v) => {
          if (!disabled) {
            onChange(v as Provider);
          }
        }}
        disabled={disabled}
      >
        {disabled ? (
          <TooltipProvider delayDuration={250}>
            <Tooltip>
              <TooltipTrigger asChild>
                <SelectTrigger
                  aria-disabled
                  className={`h-9 w-full border-none bg-gray-100 dark:bg-gray-700 ${
                    disabled ? 'cursor-not-allowed opacity-60' : ''
                  }`}
                >
                  <div className="flex w-full min-w-0 items-center gap-2 overflow-hidden">
                    <img
                      src={currentProvider.logo}
                      alt={currentProvider.alt}
                      className={`h-4 w-4 shrink-0 rounded-sm ${currentProvider.invertInDark ? 'dark:invert' : ''}`}
                    />
                    <SelectValue placeholder="Select provider" />
                  </div>
                </SelectTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <p>Provider is locked for this conversation.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <SelectTrigger className="h-9 w-full border-none bg-gray-100 dark:bg-gray-700">
            <div className="flex w-full min-w-0 items-center gap-2 overflow-hidden">
              <img
                src={currentProvider.logo}
                alt={currentProvider.alt}
                className={`h-4 w-4 shrink-0 rounded-sm ${currentProvider.invertInDark ? 'dark:invert' : ''}`}
              />
              <SelectValue placeholder="Select provider" />
            </div>
          </SelectTrigger>
        )}
        <SelectContent side="top">
          <TooltipProvider delayDuration={150}>
            {Object.entries(providerConfig).map(([key, config]) => (
              <TooltipRow key={key} id={key as UiProvider}>
                <SelectItem value={key}>
                  <div className="flex items-center gap-2">
                    <img
                      src={config.logo}
                      alt={config.alt}
                      className={`h-4 w-4 rounded-sm ${config.invertInDark ? 'dark:invert' : ''}`}
                    />
                    <SelectItemText>{config.name}</SelectItemText>
                  </div>
                </SelectItem>
              </TooltipRow>
            ))}
          </TooltipProvider>
        </SelectContent>
      </Select>
    </div>
  );
};

const TooltipRow: React.FC<{ id: UiProvider; children: React.ReactElement }> = ({ id, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open}>
      <TooltipTrigger asChild>
        {React.cloneElement(children, {
          onMouseEnter: () => setOpen(true),
          onMouseLeave: () => setOpen(false),
          onPointerEnter: () => setOpen(true),
          onPointerLeave: () => setOpen(false),
        })}
      </TooltipTrigger>
      <TooltipContent
        side="right"
        align="start"
        className="p-0 bg-background text-foreground border-foreground/20"
      >
        <ProviderInfoCard id={id} />
      </TooltipContent>
    </Tooltip>
  );
};

export default ProviderSelector;
