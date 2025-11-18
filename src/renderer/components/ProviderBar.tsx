import React from 'react';
import { ExternalLink } from 'lucide-react';
import { type Provider } from '../types';
import { type LinearIssueSummary } from '../types/linear';
import { type GitHubIssueSummary } from '../types/github';
import { type JiraIssueSummary } from '../types/jira';
import openaiLogo from '../../assets/images/openai.png';
import kiroLogo from '../../assets/images/kiro.png';
import linearLogo from '../../assets/images/linear.png';
import githubLogo from '../../assets/images/github.png';
import jiraLogo from '../../assets/images/jira.png';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { Check } from 'lucide-react';
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
import atlassianLogo from '../../assets/images/atlassian.png';
import PlanModeToggle from './PlanModeToggle';

type Props = {
  provider: Provider;
  linearIssue?: LinearIssueSummary | null;
  githubIssue?: GitHubIssueSummary | null;
  jiraIssue?: JiraIssueSummary | null;
  planModeEnabled?: boolean;
  onPlanModeChange?: (next: boolean) => void;
  onApprovePlan?: () => void;
};

export const ProviderBar: React.FC<Props> = ({
  provider,
  linearIssue,
  githubIssue,
  jiraIssue,
  planModeEnabled,
  onPlanModeChange,
  onApprovePlan,
}) => {
  const map: Record<Provider, { name: string; logo: string }> = {
    qwen: { name: 'Qwen Code', logo: qwenLogo },
    codex: { name: 'Codex', logo: openaiLogo },
    claude: { name: 'Claude Code', logo: claudeLogo },
    droid: { name: 'Droid', logo: factoryLogo },
    gemini: { name: 'Gemini', logo: geminiLogo },
    cursor: { name: 'Cursor', logo: cursorLogo },
    copilot: { name: 'Copilot', logo: copilotLogo },
    amp: { name: 'Amp', logo: ampLogo },
    opencode: { name: 'OpenCode', logo: opencodeLogo },
    charm: { name: 'Charm', logo: charmLogo },
    auggie: { name: 'Auggie', logo: augmentLogo },
    goose: { name: 'Goose', logo: gooseLogo },
    kimi: { name: 'Kimi', logo: kimiLogo },
    kiro: { name: 'Kiro', logo: kiroLogo },
    rovo: { name: 'Rovo Dev', logo: atlassianLogo },
  };
  const cfg = map[provider] ?? { name: provider, logo: '' };
  return (
    <div className="px-6 pb-6 pt-4">
      <div className="mx-auto max-w-4xl">
        <div className="relative rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center rounded-md px-4 py-3">
            <div className="flex items-center gap-3">
              <TooltipProvider delayDuration={250}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className="inline-flex h-7 cursor-default select-none items-center gap-1.5 rounded-md border border-gray-200 bg-gray-100 px-2 text-xs text-foreground dark:border-gray-700 dark:bg-gray-700"
                      role="button"
                      aria-disabled
                      title={cfg.name}
                    >
                      {cfg.logo ? (
                        <img
                          src={cfg.logo}
                          alt={cfg.name}
                          title={cfg.name}
                          className={`h-3.5 w-3.5 flex-shrink-0 rounded-sm object-contain align-middle ${provider === 'codex' || provider === 'auggie' ? 'dark:invert' : ''}`}
                        />
                      ) : (
                        <div
                          className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-[3px] bg-gray-300 text-[9px] text-gray-700 dark:bg-gray-600 dark:text-gray-200"
                          aria-hidden
                        >
                          {cfg.name.slice(0, 1)}
                        </div>
                      )}
                      <span className="max-w-[12rem] truncate font-medium">{cfg.name}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Provider is locked for this conversation.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {linearIssue ? (
                <TooltipProvider delayDuration={250}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-gray-200 bg-gray-100 px-2 text-xs text-foreground dark:border-gray-700 dark:bg-gray-700"
                        title={`${linearIssue.identifier} — ${linearIssue.title || ''}`}
                        onClick={() => {
                          try {
                            if (linearIssue.url)
                              (window as any).electronAPI?.openExternal?.(linearIssue.url);
                          } catch {}
                        }}
                      >
                        <img src={linearLogo} alt="Linear" className="h-3.5 w-3.5" />
                        <span className="font-medium">{linearIssue.identifier}</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      className="max-w-sm bg-white text-foreground dark:bg-gray-900 dark:text-foreground"
                    >
                      <div className="text-xs">
                        <div className="mb-1.5 flex min-w-0 items-center gap-2">
                          <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 dark:border-gray-700 dark:bg-gray-800">
                            <img src={linearLogo} alt="Linear" className="h-3.5 w-3.5" />
                            <span className="text-[11px] font-medium text-foreground">
                              {linearIssue.identifier}
                            </span>
                          </span>
                          {linearIssue.title ? (
                            <span className="truncate text-foreground">{linearIssue.title}</span>
                          ) : null}
                        </div>
                        <div className="space-y-0.5 text-muted-foreground">
                          {linearIssue.state?.name ? (
                            <div>
                              <span className="font-medium">State:</span> {linearIssue.state?.name}
                            </div>
                          ) : null}
                          {linearIssue.assignee?.displayName || linearIssue.assignee?.name ? (
                            <div>
                              <span className="font-medium">Assignee:</span>{' '}
                              {linearIssue.assignee?.displayName || linearIssue.assignee?.name}
                            </div>
                          ) : null}
                          {linearIssue.team?.key ? (
                            <div>
                              <span className="font-medium">Team:</span> {linearIssue.team?.key}
                            </div>
                          ) : null}
                          {linearIssue.project?.name ? (
                            <div>
                              <span className="font-medium">Project:</span>{' '}
                              {linearIssue.project?.name}
                            </div>
                          ) : null}
                          {linearIssue.url ? (
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium">Ticket:</span>
                              <a
                                href={linearIssue.url}
                                target="_blank"
                                rel="noreferrer"
                                title="Open in Linear"
                                className="inline-flex items-center rounded p-0.5 text-muted-foreground hover:text-foreground"
                                onClick={(e) => {
                                  e.preventDefault();
                                  try {
                                    (window as any).electronAPI?.openExternal?.(linearIssue.url!);
                                  } catch {}
                                }}
                              >
                                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                <span className="sr-only">Open in Linear</span>
                              </a>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : null}
              {githubIssue ? (
                <TooltipProvider delayDuration={250}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-gray-200 bg-gray-100 px-2 text-xs text-foreground dark:border-gray-700 dark:bg-gray-700"
                        title={`#${githubIssue.number} — ${githubIssue.title || ''}`}
                        onClick={() => {
                          try {
                            if (githubIssue.url)
                              (window as any).electronAPI?.openExternal?.(githubIssue.url);
                          } catch {}
                        }}
                      >
                        <img src={githubLogo} alt="GitHub" className="h-3.5 w-3.5" />
                        <span className="font-medium">#{githubIssue.number}</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-sm">
                      <div className="text-xs">
                        <div className="mb-1.5 flex min-w-0 items-center gap-2">
                          <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 dark:border-gray-700 dark:bg-gray-800">
                            <img src={githubLogo} alt="GitHub" className="h-3.5 w-3.5" />
                            <span className="text-[11px] font-medium text-foreground">
                              #{githubIssue.number}
                            </span>
                          </span>
                          {githubIssue.title ? (
                            <span className="truncate text-foreground">{githubIssue.title}</span>
                          ) : null}
                          {githubIssue.url ? (
                            <div className="ml-auto">
                              <a
                                href={githubIssue.url}
                                onClick={(e) => {
                                  e.preventDefault();
                                  try {
                                    (window as any).electronAPI?.openExternal?.(githubIssue.url!);
                                  } catch {}
                                }}
                              >
                                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                <span className="sr-only">Open on GitHub</span>
                              </a>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : null}
              {jiraIssue ? (
                <TooltipProvider delayDuration={250}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-gray-200 bg-gray-100 px-2 text-xs text-foreground dark:border-gray-700 dark:bg-gray-700"
                        title={`${jiraIssue.key} — ${jiraIssue.summary || ''}`}
                        onClick={() => {
                          try {
                            if (jiraIssue.url)
                              (window as any).electronAPI?.openExternal?.(jiraIssue.url);
                          } catch {}
                        }}
                      >
                        <img src={jiraLogo} alt="Jira" className="h-3.5 w-3.5" />
                        <span className="font-medium">{jiraIssue.key}</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-sm">
                      <div className="text-xs">
                        <div className="mb-1.5 flex min-w-0 items-center gap-2">
                          <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 dark:border-gray-700 dark:bg-gray-800">
                            <img src={jiraLogo} alt="Jira" className="h-3.5 w-3.5" />
                            <span className="text-[11px] font-medium text-foreground">
                              {jiraIssue.key}
                            </span>
                          </span>
                          {jiraIssue.summary ? (
                            <span className="truncate text-foreground">{jiraIssue.summary}</span>
                          ) : null}
                        </div>
                        <div className="space-y-0.5 text-muted-foreground">
                          {jiraIssue.status?.name ? (
                            <div>
                              <span className="font-medium">Status:</span> {jiraIssue.status.name}
                            </div>
                          ) : null}
                          {jiraIssue.assignee?.displayName || jiraIssue.assignee?.name ? (
                            <div>
                              <span className="font-medium">Assignee:</span>{' '}
                              {jiraIssue.assignee?.displayName || jiraIssue.assignee?.name}
                            </div>
                          ) : null}
                          {jiraIssue.project?.key ? (
                            <div>
                              <span className="font-medium">Project:</span> {jiraIssue.project?.key}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : null}
              <PlanModeToggle value={!!planModeEnabled} onChange={onPlanModeChange} />
              {planModeEnabled ? (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => {
                          if (onApprovePlan) onApprovePlan();
                          else onPlanModeChange?.(false);
                        }}
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-accent/60 bg-accent/10 px-2 text-xs text-foreground hover:bg-accent/15 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/40"
                        title="Approve Plan & Exit"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="font-medium">Exit Plan Mode</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      Approve the plan and exit Plan Mode
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProviderBar;
