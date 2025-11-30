import React, { useEffect, useMemo, useRef, useState } from 'react';
import { type Workspace } from '../types/chat';
import { type Provider } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import OpenInMenu from './titlebar/OpenInMenu';
import { TerminalPane } from './TerminalPane';
import { providerMeta } from '@/providers/meta';
import { providerAssets } from '@/providers/assets';
import { useTheme } from '@/hooks/useTheme';
import { classifyActivity } from '@/lib/activityClassifier';
import { CornerDownLeft } from 'lucide-react';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';

interface Props {
  workspace: Workspace;
  projectName: string;
  projectId: string;
}

type Variant = {
  id: string;
  provider: Provider;
  name: string;
  branch: string;
  path: string;
  worktreeId: string;
};

const MultiAgentWorkspace: React.FC<Props> = ({ workspace }) => {
  const { effectiveTheme } = useTheme();
  const [prompt, setPrompt] = useState('');
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const multi = workspace.metadata?.multiAgent;
  const variants = (multi?.variants || []) as Variant[];

  // Helper to generate display label with instance number if needed
  const getVariantDisplayLabel = (variant: Variant): string => {
    const meta = providerMeta[variant.provider];
    const baseName = meta?.label || variant.provider;

    // Count how many variants use this provider
    const providerVariants = variants.filter((v) => v.provider === variant.provider);

    // If only one instance of this provider, just show base name
    if (providerVariants.length === 1) {
      return baseName;
    }

    // Multiple instances: extract instance number from variant name
    // variant.name format: "workspace-provider-1", "workspace-provider-2", etc.
    const match = variant.name.match(/-(\d+)$/);
    const instanceNum = match ? match[1] : String(providerVariants.indexOf(variant) + 1);

    return `${baseName} #${instanceNum}`;
  };

  // Build initial issue context (feature parity with single-agent ChatInterface)
  const initialInjection: string | null = useMemo(() => {
    const md: any = workspace.metadata || null;
    if (!md) return null;
    const p = (md.initialPrompt || '').trim();
    if (p) return p;
    // Linear
    const issue = md.linearIssue;
    if (issue) {
      const parts: string[] = [];
      const line1 = `Linked Linear issue: ${issue.identifier}${issue.title ? ` — ${issue.title}` : ''}`;
      parts.push(line1);
      const details: string[] = [];
      if (issue.state?.name) details.push(`State: ${issue.state.name}`);
      if (issue.assignee?.displayName || issue.assignee?.name)
        details.push(`Assignee: ${issue.assignee?.displayName || issue.assignee?.name}`);
      if (issue.team?.key) details.push(`Team: ${issue.team.key}`);
      if (issue.project?.name) details.push(`Project: ${issue.project.name}`);
      if (details.length) parts.push(`Details: ${details.join(' • ')}`);
      if (issue.url) parts.push(`URL: ${issue.url}`);
      const desc = (issue as any)?.description;
      if (typeof desc === 'string' && desc.trim()) {
        const trimmed = desc.trim();
        const max = 1500;
        const body = trimmed.length > max ? trimmed.slice(0, max) + '\n…' : trimmed;
        parts.push('', 'Issue Description:', body);
      }
      return parts.join('\n');
    }
    // GitHub
    const gh = (md as any)?.githubIssue as
      | {
          number: number;
          title?: string;
          url?: string;
          state?: string;
          assignees?: any[];
          labels?: any[];
          body?: string;
        }
      | undefined;
    if (gh) {
      const parts: string[] = [];
      const line1 = `Linked GitHub issue: #${gh.number}${gh.title ? ` — ${gh.title}` : ''}`;
      parts.push(line1);
      const details: string[] = [];
      if (gh.state) details.push(`State: ${gh.state}`);
      try {
        const as = Array.isArray(gh.assignees)
          ? gh.assignees
              .map((a: any) => a?.name || a?.login)
              .filter(Boolean)
              .join(', ')
          : '';
        if (as) details.push(`Assignees: ${as}`);
      } catch {}
      try {
        const ls = Array.isArray(gh.labels)
          ? gh.labels
              .map((l: any) => l?.name)
              .filter(Boolean)
              .join(', ')
          : '';
        if (ls) details.push(`Labels: ${ls}`);
      } catch {}
      if (details.length) parts.push(`Details: ${details.join(' • ')}`);
      if (gh.url) parts.push(`URL: ${gh.url}`);
      const body = typeof gh.body === 'string' ? gh.body.trim() : '';
      if (body) {
        const max = 1500;
        const clipped = body.length > max ? body.slice(0, max) + '\n…' : body;
        parts.push('', 'Issue Description:', clipped);
      }
      return parts.join('\n');
    }
    // Jira
    const j = md?.jiraIssue as any;
    if (j) {
      const lines: string[] = [];
      const l1 = `Linked Jira issue: ${j.key}${j.summary ? ` — ${j.summary}` : ''}`;
      lines.push(l1);
      const details: string[] = [];
      if (j.status?.name) details.push(`Status: ${j.status.name}`);
      if (j.assignee?.displayName || j.assignee?.name)
        details.push(`Assignee: ${j.assignee?.displayName || j.assignee?.name}`);
      if (j.project?.key) details.push(`Project: ${j.project.key}`);
      if (details.length) lines.push(`Details: ${details.join(' • ')}`);
      if (j.url) lines.push(`URL: ${j.url}`);
      return lines.join('\n');
    }
    return null;
  }, [workspace.metadata]);

  // Robust prompt injection modeled after useInitialPromptInjection, without one-shot gating
  const injectPrompt = async (ptyId: string, provider: Provider, text: string) => {
    const trimmed = (text || '').trim();
    if (!trimmed) return;
    let sent = false;
    let silenceTimer: any = null;
    const send = () => {
      if (sent) return;
      try {
        (window as any).electronAPI?.ptyInput?.({ id: ptyId, data: trimmed + '\n' });
        sent = true;
      } catch {}
    };
    const offData = (window as any).electronAPI?.onPtyData?.(ptyId, (chunk: string) => {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        if (!sent) send();
      }, 1000);
      try {
        const signal = classifyActivity(provider, chunk);
        if (signal === 'idle' && !sent) {
          setTimeout(send, 200);
        }
      } catch {}
    });
    const offStarted = (window as any).electronAPI?.onPtyStarted?.((info: { id: string }) => {
      if (info?.id === ptyId) {
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          if (!sent) send();
        }, 1500);
      }
    });
    // Fallback in case no events arrive
    // Try once shortly in case PTY is already interactive
    const eager = setTimeout(() => {
      if (!sent) send();
    }, 300);

    const hard = setTimeout(() => {
      if (!sent) send();
    }, 5000);
    // Give the injector a brief window; cleanup shortly after send
    setTimeout(() => {
      clearTimeout(eager);
      clearTimeout(hard);
      if (silenceTimer) clearTimeout(silenceTimer);
      offData?.();
      offStarted?.();
    }, 6000);
  };

  const handleRunAll = async () => {
    const msg = prompt.trim();
    if (!msg) return;
    // Send concurrently via PTY injection for all providers (Codex/Claude included)
    const tasks: Promise<any>[] = [];
    variants.forEach((v) => {
      const termId = `${v.worktreeId}-main`;
      tasks.push(injectPrompt(termId, v.provider, msg));
    });
    await Promise.all(tasks);
    // Clear the input after sending
    setPrompt('');
  };

  // Prefill the top input with the prepared issue context once (user can edit before sending)
  const prefillOnceRef = useRef(false);
  useEffect(() => {
    if (prefillOnceRef.current) return;
    const text = (initialInjection || '').trim();
    if (text && !prompt) {
      setPrompt(text);
    }
    prefillOnceRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialInjection]);

  if (!multi?.enabled || variants.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Multi-agent config missing for this workspace.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {variants.map((v, idx) => {
        const isDark = effectiveTheme === 'dark';
        const isActive = idx === activeTabIndex;
        return (
          <div
            key={v.worktreeId}
            className={`flex-1 overflow-hidden ${isActive ? 'block' : 'hidden'}`}
          >
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-end gap-2 px-3 py-1.5">
                <OpenInMenu path={v.path} />
              </div>
              <div className="mt-8 flex items-center justify-center px-4 py-2">
                <TooltipProvider delayDuration={250}>
                  <div className="flex items-center gap-2">
                    {variants.map((variant, tabIdx) => {
                      const asset = providerAssets[variant.provider];
                      const meta = providerMeta[variant.provider];
                      const isTabActive = tabIdx === activeTabIndex;
                      return (
                        <Tooltip key={variant.worktreeId}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => setActiveTabIndex(tabIdx)}
                              className={`inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-medium transition-all ${
                                isTabActive
                                  ? 'border-2 border-foreground/30 bg-background text-foreground shadow-sm'
                                  : 'border border-border/50 bg-transparent text-muted-foreground hover:border-border/70 hover:bg-background/50 hover:text-foreground'
                              }`}
                            >
                              {asset?.logo ? (
                                <img
                                  src={asset.logo}
                                  alt={asset.alt || meta?.label || variant.provider}
                                  className={`h-4 w-4 shrink-0 object-contain ${asset?.invertInDark ? 'dark:invert' : ''}`}
                                />
                              ) : null}
                              <span>{getVariantDisplayLabel(variant)}</span>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{variant.name}</p>
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </TooltipProvider>
              </div>
              <div className="min-h-0 flex-1 px-6 pt-4">
                <div
                  className={`mx-auto h-full max-w-4xl overflow-hidden rounded-md ${
                    isDark ? 'bg-gray-800' : 'bg-white'
                  }`}
                >
                  <TerminalPane
                    id={`${v.worktreeId}-main`}
                    cwd={v.path}
                    shell={providerMeta[v.provider].cli}
                    autoApprove={workspace.metadata?.autoApprove ?? false}
                    keepAlive
                    variant={isDark ? 'dark' : 'light'}
                    className="h-full w-full"
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })}

      <div className="px-6 pb-6 pt-4">
        <div className="mx-auto max-w-4xl">
          <div className="relative rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center gap-2 rounded-md px-4 py-3">
              <Input
                className="h-9 flex-1 border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-700"
                placeholder="Tell the agents what to do..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (prompt.trim()) {
                      void handleRunAll();
                    }
                  }
                }}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-9 border border-gray-200 bg-gray-100 px-3 text-xs font-medium hover:bg-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600"
                onClick={handleRunAll}
                disabled={!prompt.trim()}
                title="Run in all panes (Enter)"
                aria-label="Run in all panes"
              >
                <CornerDownLeft className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MultiAgentWorkspace;
