import React from 'react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './ui/select';
import { type Agent } from '../types';
import { agentConfig } from '../lib/agentConfig';

interface AgentDropdownProps {
  value: Agent;
  onChange: (agent: Agent) => void;
  disabledAgents?: string[];
  className?: string;
}

export const AgentDropdown: React.FC<AgentDropdownProps> = ({
  value,
  onChange,
  disabledAgents = [],
  className = '',
}) => {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Agent)}>
      <SelectTrigger className={`h-9 w-full border-none bg-muted ${className}`}>
        <SelectValue placeholder="Select agent" />
      </SelectTrigger>
      <SelectContent side="top" className="z-[120]">
        {Object.entries(agentConfig).map(([key, config]) => {
          const isDisabled = disabledAgents.includes(key);
          return (
            <SelectItem key={key} value={key} disabled={isDisabled}>
              <div className="flex items-center gap-2">
                <img
                  src={config.logo}
                  alt={config.alt}
                  className={`h-4 w-4 rounded-sm ${isDisabled ? 'grayscale' : ''} ${config.invertInDark ? 'dark:invert' : ''}`}
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
