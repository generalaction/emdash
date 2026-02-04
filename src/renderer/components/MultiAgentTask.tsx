import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Task } from '../types/chat';
import { type Agent } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import OpenInMenu from './titlebar/OpenInMenu';
import { TerminalPane } from './TerminalPane';
import { agentMeta } from '@/providers/meta';
import { agentAssets } from '@/providers/assets';
import { useTheme } from '@/hooks/useTheme';
import { classifyActivity } from '@/lib/activityClassifier';
import { activityStore } from '@/lib/activityStore';
import { Spinner } from './ui/spinner';
import { BUSY_HOLD_MS, CLEAR_BUSY_MS } from '@/lib/activityConstants';
import { CornerDownLeft } from 'lucide-react';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { useAutoScrollOnTaskSwitch } from '@/hooks/useAutoScrollOnTaskSwitch';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './ui/resizable';
import { Checkbox } from './ui/checkbox';
import { terminalSessionRegistry } from '../terminal/SessionRegistry';

interface Props {
  task: Task;
  projectName: string;
  projectId: string;
}

type Variant = {
  id: string;
  agent: Agent;
  name: string;
  branch: string;
  path: string;
  worktreeId: string;
};

const splitViewStorageKey = (taskId: string) => `emdash:multiAgentSplitView:${taskId}`;
const activeVariantStorageKey = (taskId: string) => `emdash:multiAgentActiveVariant:${taskId}`;

const readSplitViewPreference = (task: Task): boolean => {
  const fromMeta = task.metadata?.multiAgent?.splitViewEnabled;
  if (typeof fromMeta === 'boolean') return fromMeta;
  try {
    const stored = localStorage.getItem(splitViewStorageKey(task.id));
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    // ignore storage errors
  }
  return true;
};

const readActiveVariantId = (task: Task): string | null => {
  const fromMeta = task.metadata?.multiAgent?.activeVariantId;
  if (typeof fromMeta === 'string' && fromMeta.trim()) return fromMeta.trim();
  try {
    const stored = localStorage.getItem(activeVariantStorageKey(task.id));
    if (stored && stored.trim()) return stored.trim();
  } catch {
    // ignore storage errors
  }
  return null;
};

const resolveActiveTabIndex = (task: Task, variants: Variant[]): number => {
  if (!variants.length) return 0;
  const activeId = readActiveVariantId(task);
  if (activeId) {
    const idx = variants.findIndex(
      (variant) => variant.worktreeId === activeId || variant.id === activeId
    );
    if (idx >= 0) return idx;
  }
  return 0;
};

const MultiAgentTask: React.FC<Props> = ({ task }) => {
  const { effectiveTheme } = useTheme();
  const multi = task.metadata?.multiAgent;
  const variants = (multi?.variants || []) as Variant[];
  const [prompt, setPrompt] = useState('');
  const [activeTabIndex, setActiveTabIndex] = useState(() => resolveActiveTabIndex(task, variants));
  const [splitViewEnabled, setSplitViewEnabled] = useState<boolean>(() =>
    readSplitViewPreference(task)
  );
  const [variantBusy, setVariantBusy] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setSplitViewEnabled(readSplitViewPreference(task));
  }, [task.id, task.metadata?.multiAgent?.splitViewEnabled]);

  useEffect(() => {
    if (!variants.length) return;
    const nextIndex = resolveActiveTabIndex(task, variants);
    setActiveTabIndex((current) => (current === nextIndex ? current : nextIndex));
  }, [task.id, task.metadata?.multiAgent?.activeVariantId, variants]);

  useEffect(() => {
    if (activeTabIndex >= variants.length) {
      setActiveTabIndex(0);
    }
  }, [activeTabIndex, variants.length]);

  const persistActiveVariant = useCallback(
    (variant: Variant) => {
      const id = variant.worktreeId || variant.id;
      if (!id) return;
      try {
        localStorage.setItem(activeVariantStorageKey(task.id), id);
      } catch {
        // ignore storage errors
      }
      if (!multi?.enabled) return;
      const currentId = task.metadata?.multiAgent?.activeVariantId;
      if (currentId === id) return;
      const nextMetadata = {
        ...(task.metadata || {}),
        multiAgent: {
          ...(multi || { enabled: true, variants: [] }),
          activeVariantId: id,
        },
      };
      void window.electronAPI.saveTask({
        ...task,
        metadata: nextMetadata,
      });
    },
    [task, multi]
  );

  useEffect(() => {
    const variant = variants[activeTabIndex];
    if (!variant) return;
    persistActiveVariant(variant);
  }, [activeTabIndex, variants, persistActiveVariant]);

  // Auto-scroll to bottom when this task becomes active
  const { scrollToBottom } = useAutoScrollOnTaskSwitch(true, task.id);

  // Helper to generate display label with instance number if needed
  const getVariantDisplayLabel = (variant: Variant): string => {
    const meta = agentMeta[variant.agent];
    const baseName = meta?.label || variant.agent;

    // Count how many variants use this agent
    const agentVariants = variants.filter((v) => v.agent === variant.agent);

    // If only one instance of this agent, just show base name
    if (agentVariants.length === 1) {
      return baseName;
    }

    // Multiple instances: extract instance number from variant name
    // variant.name format: "task-agent-1", "task-agent-2", etc.
    const match = variant.name.match(/-(\d+)$/);
    const instanceNum = match ? match[1] : String(agentVariants.indexOf(variant) + 1);

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

  const handleSplitViewChange = useCallback(
    (next: boolean) => {
      setSplitViewEnabled(next);
      try {
        localStorage.setItem(splitViewStorageKey(task.id), String(next));
      } catch {
        // ignore storage errors
      }
      if (!multi?.enabled) return;
      const nextMetadata = {
        ...(task.metadata || {}),
        multiAgent: {
          ...(multi || { enabled: true, variants: [] }),
          splitViewEnabled: next,
        },
      };
      void window.electronAPI.saveTask({
        ...task,
        metadata: nextMetadata,
      });
    },
    [multi, task]
  );

  const focusVariantByIndex = useCallback(
    (index: number) => {
      const variant = variants[index];
      if (!variant) return;
      const session = terminalSessionRegistry.getSession(`${variant.worktreeId}-main`);
      session?.focus();
    },
    [variants]
  );

  const focusActiveIfIdle = useCallback(() => {
    const active = document.activeElement;
    const isBodyFocus = !active || active === document.body || active === document.documentElement;
    if (!isBodyFocus) return;
    if (document.querySelector('[aria-modal="true"]')) return;
    focusVariantByIndex(activeTabIndex);
  }, [activeTabIndex, focusVariantByIndex]);

  const injectPrompt = async (ptyId: string, agent: Agent, text: string) => {
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
        const signal = classifyActivity(agent, chunk);
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
    // Send concurrently via PTY injection for all agents (Codex/Claude included)
    const tasks: Promise<any>[] = [];
    variants.forEach((v) => {
      const termId = `${v.worktreeId}-main`;
      tasks.push(injectPrompt(termId, v.agent, msg));
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
          const signal = classifyActivity(variant.agent, chunk || '');
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

  // Re-focus terminal when the app regains focus (e.g., Cmd+Tab back)
  useEffect(() => {
    let timeout: number | null = null;
    const handleFocus = () => {
      if (timeout) window.clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        if (!document.hasFocus()) return;
        focusActiveIfIdle();
      }, 60);
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
      if (timeout) window.clearTimeout(timeout);
    };
  }, [focusActiveIfIdle]);

  // Auto-scroll and focus when task or active tab changes
  useEffect(() => {
    if (variants.length > 0 && activeTabIndex >= 0 && activeTabIndex < variants.length) {
      // Small delay to ensure the tab content is rendered
      const timeout = setTimeout(() => {
        scrollToBottom({ onlyIfNearBottom: true });
        // Focus the active terminal when switching tabs
        focusVariantByIndex(activeTabIndex);
      }, 150);

      return () => clearTimeout(timeout);
    }
  }, [task.id, activeTabIndex, variants.length, scrollToBottom, focusVariantByIndex]);

  // Switch active agent tab via global shortcuts (Cmd+Shift+J/K)
  useEffect(() => {
    const handleAgentSwitch = (event: Event) => {
      const customEvent = event as CustomEvent<{ direction: 'next' | 'prev' }>;
      if (variants.length <= 1) return;
      const direction = customEvent.detail?.direction;
      if (!direction) return;

      setActiveTabIndex((current) => {
        if (variants.length <= 1) return current;
        if (direction === 'prev') {
          return current <= 0 ? variants.length - 1 : current - 1;
        }
        return (current + 1) % variants.length;
      });
    };

    window.addEventListener('emdash:switch-agent', handleAgentSwitch);
    return () => {
      window.removeEventListener('emdash:switch-agent', handleAgentSwitch);
    };
  }, [variants.length]);

  if (!multi?.enabled) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Multi-agent config missing for this task.
      </div>
    );
  }

  // Show loading state while worktrees are being created
  if (variants.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Spinner size="lg" />
        <p className="text-sm text-muted-foreground">Creating task...</p>
      </div>
    );
  }

  const isDark = effectiveTheme === 'dark' || effectiveTheme === 'dark-black';
  const canSplit = variants.length > 1;
  const shouldSplit = splitViewEnabled && canSplit;
  const panelDefaultSize = variants.length > 0 ? 100 / variants.length : 100;
  const panelMinSize = Math.max(12, Math.floor(90 / Math.max(1, variants.length)));

  const renderTerminal = (variant: Variant) => (
    <div
      className={`h-full overflow-hidden rounded-md ${
        variant.agent === 'mistral'
          ? isDark
            ? 'bg-[#202938]'
            : 'bg-white'
          : isDark
            ? 'bg-card'
            : 'bg-white'
      }`}
    >
      <TerminalPane
        id={`${variant.worktreeId}-main`}
        cwd={variant.path}
        providerId={variant.agent}
        autoApprove={
          Boolean(task.metadata?.autoApprove) && Boolean(agentMeta[variant.agent]?.autoApproveFlag)
        }
        initialPrompt={
          agentMeta[variant.agent]?.initialPromptFlag !== undefined &&
          !task.metadata?.initialInjectionSent
            ? (initialInjection ?? undefined)
            : undefined
        }
        keepAlive
        variant={isDark ? 'dark' : 'light'}
        themeOverride={
          variant.agent === 'mistral'
            ? {
                background:
                  effectiveTheme === 'dark-black' ? '#141820' : isDark ? '#202938' : '#ffffff',
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
          // For agents WITHOUT CLI flag support, use keystroke injection
          if (
            initialInjection &&
            !task.metadata?.initialInjectionSent &&
            agentMeta[variant.agent]?.initialPromptFlag === undefined
          ) {
            void injectPrompt(`${variant.worktreeId}-main`, variant.agent, initialInjection);
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
  );

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2">
        <TooltipProvider delayDuration={250}>
          <div className="flex flex-wrap items-center gap-2">
            {variants.map((variant, tabIdx) => {
              const asset = agentAssets[variant.agent];
              const meta = agentMeta[variant.agent];
              const isTabActive = tabIdx === activeTabIndex;
              return (
                <Tooltip key={variant.worktreeId}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTabIndex(tabIdx);
                        focusVariantByIndex(tabIdx);
                      }}
                      className={`inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-medium transition-all ${
                        isTabActive
                          ? 'border-2 border-foreground/30 bg-background text-foreground shadow-sm'
                          : 'border border-border/50 bg-transparent text-muted-foreground hover:border-border/70 hover:bg-background/50 hover:text-foreground'
                      }`}
                    >
                      {asset?.logo ? (
                        <img
                          src={asset.logo}
                          alt={asset.alt || meta?.label || variant.agent}
                          className={`h-4 w-4 shrink-0 object-contain ${asset?.invertInDark ? 'dark:invert' : ''}`}
                        />
                      ) : null}
                      <span>{getVariantDisplayLabel(variant)}</span>
                      {variantBusy[variant.worktreeId] ? (
                        <Spinner
                          size="sm"
                          className={isTabActive ? 'text-foreground' : 'text-muted-foreground'}
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
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={splitViewEnabled}
            disabled={!canSplit}
            onCheckedChange={(checked) => handleSplitViewChange(checked === true)}
            className="mt-[1px]"
          />
          <span>Split view</span>
        </label>
      </div>

      <div className="min-h-0 flex-1 px-6 pb-2">
        {shouldSplit ? (
          <ResizablePanelGroup direction="horizontal" className="h-full w-full">
            {variants.map((variant, idx) => {
              const asset = agentAssets[variant.agent];
              const meta = agentMeta[variant.agent];
              const isActive = idx === activeTabIndex;
              return (
                <React.Fragment key={variant.worktreeId}>
                  <ResizablePanel
                    defaultSize={panelDefaultSize}
                    minSize={panelMinSize}
                    className="min-w-0"
                  >
                    <div
                      className={`flex h-full flex-col overflow-hidden rounded-md border ${
                        isActive ? 'ring-2 ring-primary/30' : ''
                      }`}
                      onMouseDown={() => setActiveTabIndex(idx)}
                      onClick={() => setActiveTabIndex(idx)}
                    >
                      <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2 text-xs font-medium">
                          {asset?.logo ? (
                            <img
                              src={asset.logo}
                              alt={asset.alt || meta?.label || variant.agent}
                              className={`h-4 w-4 shrink-0 object-contain ${asset?.invertInDark ? 'dark:invert' : ''}`}
                            />
                          ) : null}
                          <span className="truncate">{getVariantDisplayLabel(variant)}</span>
                          {isActive ? (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                              Active
                            </span>
                          ) : null}
                          {variantBusy[variant.worktreeId] ? (
                            <Spinner
                              size="sm"
                              className={isActive ? 'text-foreground' : 'text-muted-foreground'}
                            />
                          ) : null}
                        </div>
                        <OpenInMenu path={variant.path} />
                      </div>
                      <div className="min-h-0 flex-1 p-2">{renderTerminal(variant)}</div>
                    </div>
                  </ResizablePanel>
                  {idx < variants.length - 1 ? <ResizableHandle withHandle /> : null}
                </React.Fragment>
              );
            })}
          </ResizablePanelGroup>
        ) : (
          <div className="relative h-full">
            {variants.map((variant, idx) => {
              const isActive = idx === activeTabIndex;
              return (
                <div
                  key={variant.worktreeId}
                  className={`flex h-full flex-col ${isActive ? '' : 'invisible absolute inset-0'}`}
                >
                  <div className="flex items-center justify-end gap-2 px-3 py-1.5">
                    <OpenInMenu path={variant.path} />
                  </div>
                  <div className="min-h-0 flex-1 px-2 pt-4">
                    <div className="mx-auto h-full max-w-4xl">{renderTerminal(variant)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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
