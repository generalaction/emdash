import React from 'react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './ui/select';
import { type Agent } from '../types';
import { agentConfig } from '../lib/agentConfig';
import AgentLogo from './AgentLogo';

interface AgentDropdownProps {
  value: Agent;
  onChange: (agent: Agent) => void;
  installedAgents: string[];
  disabledAgents?: string[];
  className?: string;
}

export const AgentDropdown: React.FC<AgentDropdownProps> = ({
  value,
  onChange,
  installedAgents,
  disabledAgents = [],
  className = '',
}) => {
  const installedSet = new Set(installedAgents);
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Agent)}>
      <SelectTrigger className={`h-9 w-full border-none bg-muted ${className}`}>
        <SelectValue placeholder="Select agent" />
      </SelectTrigger>
      <SelectContent side="top" className="z-[120]">
        {Object.entries(agentConfig)
          .filter(([key]) => installedSet.has(key))
          .map(([key, config]) => {
            const isDisabled = disabledAgents.includes(key);
            return (
              <SelectItem key={key} value={key} disabled={isDisabled}>
                <div className="flex items-center gap-2">
                  <AgentLogo
                    logo={config.logo}
                    alt={config.alt}
                    isSvg={config.isSvg}
                    invertInDark={config.invertInDark}
                    className="h-4 w-4 rounded-sm"
                    grayscale={isDisabled}
                  />
                  <span className={isDisabled ? 'text-muted-foreground' : ''}>
                    {config.name}
                    {isDisabled && <span className="ml-1 text-xs">(in use)</span>}
                  </span>
                </div>
              </SelectItem>
            );
          })}
      </SelectContent>
    </Select>
  );
};

export default AgentDropdown;
