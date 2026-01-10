import React, { useEffect, useMemo, useRef, useState } from 'react';
import { type Task } from '../types/chat';
import { type Provider } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import OpenInMenu from './titlebar/OpenInMenu';
import { TerminalPane } from './TerminalPane';
import { providerMeta } from '@/providers/meta';
import { providerAssets } from '@/providers/assets';
import { useTheme } from '@/hooks/useTheme';
import { classifyActivity } from '@/lib/activityClassifier';
import { activityStore } from '@/lib/activityStore';
import { Spinner } from './ui/spinner';
import { BUSY_HOLD_MS, CLEAR_BUSY_MS } from '@/lib/activityConstants';
import { CornerDownLeft } from 'lucide-react';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { useAutoScrollOnTaskSwitch } from '@/hooks/useAutoScrollOnTaskSwitch';

interface Props {
  task: Task;
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

const MultiAgentTask: React.FC<Props> = ({ task }) => {
  const { effectiveTheme } = useTheme();
  const [prompt, setPrompt] = useState('');
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [variantBusy, setVariantBusy] = useState<Record<string, boolean>>({});
  const multi = task.metadata?.multiAgent;
  const variants = (multi?.variants || []) as Variant[];

  // Auto-scroll to bottom when this task becomes active
  const { scrollToBottom } = useAutoScrollOnTaskSwitch(true, task.id);

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
    // variant.name format: "task-provider-1", "task-provider-2", etc.
    const match = variant.name.match(/-(\d+)$/);
    const instanceNum = match ? match[1] : String(providerVariants.indexOf(variant) + 1);

    return `${baseName} #${instanceNum}`;
  };

  // Build initial issue context (feature parity with single-agent ChatInterface)
  const initialInjection: string | null = useMemo(() => {
    const md: any = task.metadata || null;
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
  }, [task.metadata]);

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
    setPrompt('');
  };

  // Track per-variant activity so we can render a spinner on the tabs
  useEffect(() => {
    if (!variants.length) {
      setVariantBusy({});
      return;
    }

    // Keep busy state only for currently mounted variants
    setVariantBusy((prev) => {
      const next: Record<string, boolean> = {};
      variants.forEach((v) => {
        next[v.worktreeId] = prev[v.worktreeId] ?? false;
      });
      return next;
    });

    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const busySince = new Map<string, number>();
    const busyState = new Map<string, boolean>();

    const publish = (variantId: string, busy: boolean) => {
      busyState.set(variantId, busy);
      setVariantBusy((prev) => {
        if (prev[variantId] === busy) return prev;
        return { ...prev, [variantId]: busy };
      });
    };

    const clearTimer = (variantId: string) => {
      const t = timers.get(variantId);
      if (t) clearTimeout(t);
      timers.delete(variantId);
    };

    const setBusy = (variantId: string, busy: boolean) => {
      const current = busyState.get(variantId) || false;
      if (busy) {
        clearTimer(variantId);
        busySince.set(variantId, Date.now());
        if (!current) publish(variantId, true);
        return;
      }

      const started = busySince.get(variantId) || 0;
      const elapsed = started ? Date.now() - started : BUSY_HOLD_MS;
      const remaining = elapsed < BUSY_HOLD_MS ? BUSY_HOLD_MS - elapsed : 0;

      const clearNow = () => {
        clearTimer(variantId);
        busySince.delete(variantId);
        if (busyState.get(variantId) !== false) publish(variantId, false);
      };

      if (remaining > 0) {
        clearTimer(variantId);
        timers.set(variantId, setTimeout(clearNow, remaining));
      } else {
        clearNow();
      }
    };

    const armNeutral = (variantId: string) => {
      if (!busyState.get(variantId)) return;
      clearTimer(variantId);
      timers.set(
        variantId,
        setTimeout(() => setBusy(variantId, false), CLEAR_BUSY_MS)
      );
    };

    const cleanups: Array<() => void> = [];

    variants.forEach((variant) => {
      const variantId = variant.worktreeId;
      const ptyId = `${variant.worktreeId}-main`;
      busyState.set(variantId, variantBusy[variantId] ?? false);

      const offData = (window as any).electronAPI?.onPtyData?.(ptyId, (chunk: string) => {
        try {
          const signal = classifyActivity(variant.provider, chunk || '');
          if (signal === 'busy') setBusy(variantId, true);
          else if (signal === 'idle') setBusy(variantId, false);
          else armNeutral(variantId);
        } catch {
          // ignore classification failures
        }
      });
      if (offData) cleanups.push(offData);

      const offExit = (window as any).electronAPI?.onPtyExit?.(ptyId, () => {
        setBusy(variantId, false);
      });
      if (offExit) cleanups.push(offExit);
    });

    return () => {
      cleanups.forEach((off) => {
        try {
          off?.();
        } catch {}
      });
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      busySince.clear();
      busyState.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variants]);

  // Prefill the top input with the prepared issue context once
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

  // Sync variant busy state to activityStore for sidebar indicator
  useEffect(() => {
    const anyBusy = Object.values(variantBusy).some(Boolean);
    activityStore.setTaskBusy(task.id, anyBusy);
  }, [variantBusy, task.id]);

  // Scroll to bottom when active tab changes
  useEffect(() => {
    if (variants.length > 0 && activeTabIndex >= 0 && activeTabIndex < variants.length) {
      // Small delay to ensure the tab content is rendered
      const timeout = setTimeout(() => {
        scrollToBottom({ onlyIfNearTop: true });
      }, 150);
      return () => clearTimeout(timeout);
    }
  }, [activeTabIndex, variants.length, scrollToBottom]);

  if (!multi?.enabled || variants.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Multi-agent config missing for this task.
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      {variants.map((v, idx) => {
        const isDark = effectiveTheme === 'dark' || effectiveTheme === 'dark-black';
        const isActive = idx === activeTabIndex;
        return (
          <div
            key={v.worktreeId}
            className={`flex-1 overflow-hidden ${isActive ? '' : 'invisible absolute inset-0'}`}
          >
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-end gap-2 px-3 py-1.5">
                <OpenInMenu path={v.path} />
              </div>
              <div className="mt-2 flex items-center justify-center px-4 py-2">
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
                              {variantBusy[variant.worktreeId] ? (
                                <Spinner
                                  size="sm"
                                  className={
                                    isTabActive ? 'text-foreground' : 'text-muted-foreground'
                                  }
                                />
                              ) : null}
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
                    v.provider === 'mistral'
                      ? isDark
                        ? 'bg-[#202938]'
                        : 'bg-white'
                      : isDark
                        ? 'bg-card'
                        : 'bg-white'
                  }`}
                >
                  <TerminalPane
                    id={`${v.worktreeId}-main`}
                    cwd={v.path}
                    shell={providerMeta[v.provider].cli}
                    autoApprove={
                      Boolean(task.metadata?.autoApprove) &&
                      Boolean(providerMeta[v.provider]?.autoApproveFlag)
                    }
                    initialPrompt={
                      providerMeta[v.provider]?.initialPromptFlag !== undefined &&
                      !task.metadata?.initialInjectionSent
                        ? (initialInjection ?? undefined)
                        : undefined
                    }
                    keepAlive
                    variant={isDark ? 'dark' : 'light'}
                    themeOverride={
                      v.provider === 'mistral'
                        ? {
                            background:
                              effectiveTheme === 'dark-black'
                                ? '#141820'
                                : isDark
                                  ? '#202938'
                                  : '#ffffff',
                            selectionBackground: 'rgba(96, 165, 250, 0.35)',
                            selectionForeground: isDark ? '#f9fafb' : '#0f172a',
                          }
                        : effectiveTheme === 'dark-black'
                          ? {
                              background: '#000000',
                              selectionBackground: 'rgba(96, 165, 250, 0.35)',
                              selectionForeground: '#f9fafb',
                            }
                          : undefined
                    }
                    className="h-full w-full"
                    onStartSuccess={() => {
                      // For providers WITHOUT CLI flag support, use keystroke injection
                      if (
                        initialInjection &&
                        !task.metadata?.initialInjectionSent &&
                        providerMeta[v.provider]?.initialPromptFlag === undefined
                      ) {
                        void injectPrompt(`${v.worktreeId}-main`, v.provider, initialInjection);
                      }
                      // Mark initial injection as sent so it won't re-run on restart
                      if (initialInjection && !task.metadata?.initialInjectionSent) {
                        void window.electronAPI.saveTask({
                          ...task,
                          metadata: {
                            ...task.metadata,
                            initialInjectionSent: true,
                          },
                        });
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })}

      <div className="px-6 pb-6 pt-4">
        <div className="mx-auto max-w-4xl">
          <div className="relative rounded-md border border-border bg-white shadow-lg dark:border-border dark:bg-card">
            <div className="flex items-center gap-2 rounded-md px-4 py-3">
              <Input
                className="h-9 flex-1 border-border bg-muted dark:border-border dark:bg-muted"
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
                className="h-9 border border-border bg-muted px-3 text-xs font-medium hover:bg-muted dark:border-border dark:bg-muted dark:hover:bg-muted"
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

export default MultiAgentTask;
