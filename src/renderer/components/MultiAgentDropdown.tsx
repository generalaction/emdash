import React, { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { Info, ExternalLink } from 'lucide-react';
import { type Agent } from '../types';
import { type AgentRun } from '../types/chat';
import { agentConfig } from '../lib/agentConfig';
import { AgentInfoCard } from './AgentInfoCard';
import type { UiAgent } from '@/providers/meta';

const MAX_RUNS = 4;

interface MultiAgentDropdownProps {
  agentRuns: AgentRun[];
  onChange: (agentRuns: AgentRun[]) => void;
  className?: string;
  disabledAgents?: string[];
}

export const MultiAgentDropdown: React.FC<MultiAgentDropdownProps> = ({
  agentRuns,
  onChange,
  className = '',
  disabledAgents = [],
}) => {
  // Use agentConfig order directly (already properly ordered)
  const sortedAgents = Object.entries(agentConfig);
  const [open, setOpen] = useState(false);
  const [hoveredAgent, setHoveredAgent] = useState<Agent | null>(null);
  const [runsSelectOpenFor, setRunsSelectOpenFor] = useState<Agent | null>(null);

  const selectedAgents = new Set(agentRuns.map((ar) => ar.agent));

  // Checkbox: always add/remove (multi-select)
  const toggleAgent = (agent: Agent) => {
    // Don't allow toggling disabled agents
    if (disabledAgents.includes(agent)) return;

    if (selectedAgents.has(agent)) {
      if (agentRuns.length > 1) {
        onChange(agentRuns.filter((ar) => ar.agent !== agent));
      }
    } else {
      onChange([...agentRuns, { agent, runs: 1 }]);
    }
  };

  // Row click: switch when single, add when multiple
  const handleRowClick = (agent: Agent) => {
    // Don't allow clicking disabled agents
    if (disabledAgents.includes(agent)) return;
    if (selectedAgents.has(agent)) return;
    if (agentRuns.length === 1) {
      onChange([{ agent, runs: 1 }]);
    } else {
      onChange([...agentRuns, { agent, runs: 1 }]);
    }
  };

  const updateRuns = (agent: Agent, runs: number) => {
    onChange(agentRuns.map((ar) => (ar.agent === agent ? { ...ar, runs } : ar)));
  };

  const getAgentRuns = (agent: Agent): number => {
    return agentRuns.find((ar) => ar.agent === agent)?.runs ?? 1;
  };

  // Build trigger text: "Cursor, Gemini (2x), ..." - only show runs if >1
  const triggerText = agentRuns
    .map((ar) => {
      const name = agentConfig[ar.agent]?.name;
      return ar.runs > 1 ? `${name} (${ar.runs}x)` : name;
    })
    .join(', ');

  // Show logo only when single agent selected
  const singleAgent = agentRuns.length === 1 ? agentRuns[0] : null;
  const singleAgentConfig = singleAgent ? agentConfig[singleAgent.agent] : null;

  return (
    <TooltipProvider delayDuration={300}>
      <Select
        open={open}
        onOpenChange={(isOpen) => {
          setOpen(isOpen);
          if (!isOpen) {
            setHoveredAgent(null);
            setRunsSelectOpenFor(null);
          }
        }}
      >
        <SelectTrigger
          className={`flex h-9 w-full items-center justify-between border-none bg-muted px-3 text-sm ${className}`}
        >
          <div className="flex min-w-0 items-center gap-2">
            {singleAgentConfig && (
              <img
                src={singleAgentConfig.logo}
                alt={singleAgentConfig.alt}
                className={`h-4 w-4 flex-shrink-0 rounded-sm ${singleAgentConfig.invertInDark ? 'dark:invert' : ''}`}
              />
            )}
            <span className="truncate">{triggerText}</span>
          </div>
        </SelectTrigger>
        <SelectContent
          side="top"
          className="z-[1000] max-h-80 w-[var(--radix-select-trigger-width)] overflow-y-auto p-1"
        >
          <TooltipProvider delayDuration={150}>
            {sortedAgents.map(([key, config]) => {
              const agent = key as Agent;
              const isSelected = selectedAgents.has(agent);
              const isLastSelected = isSelected && agentRuns.length === 1;
              const isDisabled = disabledAgents.includes(agent);

              return !isDisabled ? (
                <AgentTooltipRow
                  key={key}
                  id={agent as UiAgent}
                  isHovered={hoveredAgent === agent || runsSelectOpenFor === agent}
                  onHover={() => setHoveredAgent(agent)}
                  onLeave={() => {
                    if (runsSelectOpenFor !== agent) {
                      setHoveredAgent(null);
                    }
                  }}
                >
                  <div
                    className="flex h-8 cursor-pointer items-center justify-between rounded-sm px-2 hover:bg-accent"
                    onClick={() => handleRowClick(agent)}
                  >
                    <div className="flex flex-1 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isLastSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleAgent(agent);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 cursor-pointer"
                      />
                      <img
                        src={config.logo}
                        alt={config.alt}
                        className={`h-4 w-4 flex-shrink-0 rounded-sm ${config.invertInDark ? 'dark:invert' : ''}`}
                      />
                      <span className="text-sm">{config.name}</span>
                    </div>
                    {isSelected && (
                      <div className="flex items-center gap-1">
                        <Select
                          value={String(getAgentRuns(agent))}
                          onValueChange={(v) => updateRuns(agent, parseInt(v, 10))}
                          onOpenChange={(isSelectOpen) => {
                            setRunsSelectOpenFor(isSelectOpen ? agent : null);
                          }}
                        >
                          <SelectTrigger
                            className="h-6 w-auto gap-1 border-none bg-transparent p-0 text-sm shadow-none"
                            title="Run up to 4 instances of this agent to compare different solutions"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent side="right" className="z-[1001] min-w-[4rem]">
                            {[1, 2, 3, 4].map((n) => (
                              <SelectItem key={n} value={String(n)}>
                                {n}x
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3 w-3 opacity-40 hover:opacity-60" />
                          </TooltipTrigger>
                          <TooltipContent
                            side="top"
                            className="z-[10000] max-w-xs"
                            style={{ zIndex: 10000 }}
                          >
                            <p>
                              Run up to {MAX_RUNS} instances of this agent to compare different
                              solutions.{' '}
                              <a
                                href="https://docs.emdash.sh/best-of-n"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 underline hover:opacity-70"
                                onClick={(e) => e.stopPropagation()}
                              >
                                Docs
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    )}
                  </div>
                </AgentTooltipRow>
              ) : (
                /* Disabled agents with tooltip */
                <Tooltip key={key}>
                  <TooltipTrigger asChild>
                    <div className="flex h-8 cursor-not-allowed items-center justify-between rounded-sm px-2 opacity-50">
                      <div className="flex flex-1 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={true}
                          className="h-4 w-4 cursor-not-allowed"
                        />
                        <img
                          src={config.logo}
                          alt={config.alt}
                          className={`h-4 w-4 flex-shrink-0 rounded-sm ${config.invertInDark ? 'dark:invert' : ''} grayscale`}
                        />
                        <span className="text-sm text-muted-foreground">
                          {config.name}
                          <span className="ml-1 text-xs">(in use)</span>
                        </span>
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="z-[10000]" style={{ zIndex: 10000 }}>
                    <p className="text-xs">This agent already has an active chat in this task</p>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </TooltipProvider>
        </SelectContent>
      </Select>
    </TooltipProvider>
  );
};

const AgentTooltipRow: React.FC<{
  id: UiAgent;
  children: React.ReactElement;
  isHovered: boolean;
  onHover: () => void;
  onLeave: () => void;
}> = ({ id, children, isHovered, onHover, onLeave }) => {
  return (
    <Tooltip open={isHovered}>
      <TooltipTrigger asChild>
        {React.cloneElement(children, {
          onMouseEnter: onHover,
          onMouseLeave: onLeave,
          onPointerEnter: onHover,
          onPointerLeave: onLeave,
        })}
      </TooltipTrigger>
      <TooltipContent
        side="left"
        align="start"
        className="z-[1000] border-foreground/20 bg-background p-0 text-foreground"
        onMouseEnter={onHover}
        onMouseLeave={onLeave}
        onPointerEnter={onHover}
        onPointerLeave={onLeave}
      >
        <AgentInfoCard id={id} />
      </TooltipContent>
    </Tooltip>
  );
};

export default MultiAgentDropdown;
