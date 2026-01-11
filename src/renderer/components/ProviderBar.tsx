import React from 'react';
import { ExternalLink, MessageSquare } from 'lucide-react';
import { type Provider } from '../types';
import { CommentsPopover } from './CommentsPopover';
import { useTaskComments } from '../hooks/useLineComments';
import { type LinearIssueSummary } from '../types/linear';
import { type GitHubIssueSummary } from '../types/github';
import { type JiraIssueSummary } from '../types/jira';
import openaiLogo from '../../assets/images/openai.png';
import kiroLogo from '../../assets/images/kiro.png';
import linearLogo from '../../assets/images/linear.png';
import githubLogo from '../../assets/images/github.png';
import jiraLogo from '../../assets/images/jira.png';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { Button } from './ui/button';
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
import kilocodeLogo from '../../assets/images/kilocode.png';
import atlassianLogo from '../../assets/images/atlassian.png';
import clineLogo from '../../assets/images/cline.png';
import continueLogo from '../../assets/images/continue.png';
import codebuffLogo from '../../assets/images/codebuff.png';
import mistralLogo from '../../assets/images/mistral.png';
import PlanModeToggle from './PlanModeToggle';
import AutoApproveIndicator from './AutoApproveIndicator';
import context7Logo from '../../assets/images/context7.png';
import Context7Tooltip from './Context7Tooltip';
import { providerMeta } from '../providers/meta';
import { getContext7InvocationForProvider } from '../mcp/context7';
import { useTaskScope } from './TaskScopeContext';

type Props = {
  provider: Provider;
  taskId?: string;
  linearIssue?: LinearIssueSummary | null;
  githubIssue?: GitHubIssueSummary | null;
  jiraIssue?: JiraIssueSummary | null;
  planModeEnabled?: boolean;
  onPlanModeChange?: (next: boolean) => void;
  onApprovePlan?: () => void;
  autoApprove?: boolean;
};

export const ProviderBar: React.FC<Props> = ({
  provider,
  taskId,
  linearIssue,
  githubIssue,
  jiraIssue,
  planModeEnabled,
  onPlanModeChange,
  onApprovePlan,
  autoApprove,
}) => {
  const [c7Enabled, setC7Enabled] = React.useState<boolean>(false);
  const [c7Busy, setC7Busy] = React.useState<boolean>(false);
  const [c7TaskEnabled, setC7TaskEnabled] = React.useState<boolean>(false);
  const { taskId: scopedTaskId } = useTaskScope();
  const resolvedTaskId = taskId ?? scopedTaskId;
  const { unsentCount } = useTaskComments(resolvedTaskId);
  const [selectedCount, setSelectedCount] = React.useState(0);

  React.useEffect(() => {
    setSelectedCount(0);
  }, [resolvedTaskId]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await (window as any).electronAPI?.getSettings?.();
        if (!cancelled && res?.success) {
          setC7Enabled(Boolean(res.settings?.mcp?.context7?.enabled));
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Per-task default OFF
  React.useEffect(() => {
    if (!resolvedTaskId) return;
    try {
      const key = `c7:ws:${resolvedTaskId}`;
      setC7TaskEnabled(localStorage.getItem(key) === '1');
    } catch {
      setC7TaskEnabled(false);
    }
  }, [resolvedTaskId]);

  const handlePlanModeChange = React.useCallback(
    (next: boolean) => {
      if (next) {
        onPlanModeChange?.(true);
        return;
      }
      if (onApprovePlan) {
        onApprovePlan();
      } else {
        onPlanModeChange?.(false);
      }
    },
    [onApprovePlan, onPlanModeChange]
  );

  const handleContext7Click = async () => {
    setC7Busy(true);
    try {
      if (!c7Enabled || !resolvedTaskId) return;

      if (!c7TaskEnabled) {
        // Enable for this task and send invocation once
        try {
          localStorage.setItem(`c7:ws:${resolvedTaskId}`, '1');
        } catch {}
        setC7TaskEnabled(true);

        const isTerminal = providerMeta[provider]?.terminalOnly === true;
        if (!isTerminal) return;
        const phrase = getContext7InvocationForProvider(provider) || 'use context7';
        const ptyId = `${provider}-main-${resolvedTaskId}`;
        (window as any).electronAPI?.ptyInput?.({ id: ptyId, data: `${phrase}\n` });
      } else {
        try {
          localStorage.removeItem(`c7:ws:${resolvedTaskId}`);
        } catch {}
        setC7TaskEnabled(false);
      }
    } finally {
      setC7Busy(false);
    }
  };

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
    kilocode: { name: 'Kilocode', logo: kilocodeLogo },
    kiro: { name: 'Kiro', logo: kiroLogo },
    rovo: { name: 'Rovo Dev', logo: atlassianLogo },
    cline: { name: 'Cline', logo: clineLogo },
    continue: { name: 'Continue', logo: continueLogo },
    codebuff: { name: 'Codebuff', logo: codebuffLogo },
    mistral: { name: 'Mistral Vibe', logo: mistralLogo },
  };
  const cfg = map[provider] ?? { name: provider, logo: '' };
  return (
    <div className="px-6 pb-6 pt-4">
      <div className="mx-auto max-w-4xl">
        <div className="relative rounded-md border border-border bg-white shadow-lg dark:border-border dark:bg-card">
          <div className="flex items-center rounded-md px-4 py-3">
            <div className="flex items-center gap-3">
              <TooltipProvider delayDuration={250}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className="inline-flex h-7 cursor-default select-none items-center gap-1.5 rounded-md border border-border bg-muted px-2 text-xs text-foreground dark:border-border dark:bg-muted"
                      role="button"
                      aria-disabled
                      title={cfg.name}
                    >
                      {cfg.logo ? (
                        <img
                          src={cfg.logo}
                          alt={cfg.name}
                          title={cfg.name}
                          className={`h-3.5 w-3.5 flex-shrink-0 rounded-sm object-contain align-middle ${provider === 'codex' || provider === 'auggie' ? 'dark-black:invert dark:invert' : ''}`}
                        />
                      ) : (
                        <div
                          className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-[3px] bg-muted text-micro text-foreground dark:bg-muted dark:text-foreground"
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
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-muted px-2 text-xs text-foreground dark:border-border dark:bg-muted"
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
                      className="max-w-sm bg-white text-foreground dark:bg-background dark:text-foreground"
                    >
                      <div className="text-xs">
                        <div className="mb-1.5 flex min-w-0 items-center gap-2">
                          <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-border bg-muted px-1.5 py-0.5 dark:border-border dark:bg-card">
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
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-muted px-2 text-xs text-foreground dark:border-border dark:bg-muted"
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
                          <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-border bg-muted px-1.5 py-0.5 dark:border-border dark:bg-card">
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
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-muted px-2 text-xs text-foreground dark:border-border dark:bg-muted"
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
                          <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-border bg-muted px-1.5 py-0.5 dark:border-border dark:bg-card">
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
              <PlanModeToggle value={!!planModeEnabled} onChange={handlePlanModeChange} />
              <AutoApproveIndicator enabled={!!autoApprove} />
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleContext7Click}
                      disabled={c7Busy || !c7Enabled}
                      className={[
                        'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs',
                        c7TaskEnabled
                          ? 'border-emerald-500/50 bg-emerald-500/10 text-foreground'
                          : 'border-border bg-muted text-foreground dark:border-border dark:bg-muted',
                      ].join(' ')}
                      title={
                        c7Enabled
                          ? c7TaskEnabled
                            ? 'Disable Context7 for this task'
                            : 'Enable for this task & send to terminal'
                          : 'Enable Context7 in Settings → MCP to use here'
                      }
                    >
                      {context7Logo ? (
                        <img
                          src={context7Logo}
                          alt="Context7"
                          className="h-3.5 w-3.5 flex-shrink-0 rounded-[3px] object-contain"
                        />
                      ) : (
                        <span
                          className="flex h-3.5 w-3.5 items-center justify-center rounded-[3px] bg-black text-micro font-semibold text-white dark:bg-white dark:text-black"
                          aria-hidden
                        >
                          C7
                        </span>
                      )}
                      <span className="font-medium">Context7 MCP</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-sm text-xs">
                    <Context7Tooltip provider={provider} enabled={c7TaskEnabled} />
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {/* Line Comments Popover - only shown when there are unsent comments */}
              {resolvedTaskId && unsentCount > 0 && (
                <CommentsPopover
                  tooltipContent="Selected comments are appended to your next agent message."
                  tooltipDelay={300}
                  onSelectedCountChange={setSelectedCount}
                >
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={[
                      'relative h-7 gap-1.5 px-2 text-xs text-foreground',
                      selectedCount > 0
                        ? 'border-blue-500/50 bg-blue-500/10 hover:bg-blue-500/15'
                        : 'border-border bg-muted dark:border-border dark:bg-muted',
                    ].join(' ')}
                    title={
                      selectedCount > 0
                        ? `${selectedCount} selected comment${selectedCount === 1 ? '' : 's'} ready to append`
                        : 'Review or select comments to append'
                    }
                  >
                    <MessageSquare className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="font-medium">Comments</span>
                    {selectedCount > 0 && (
                      <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold text-white">
                        {selectedCount}
                      </span>
                    )}
                  </Button>
                </CommentsPopover>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProviderBar;
