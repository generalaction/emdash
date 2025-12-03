import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Spinner } from './ui/spinner';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import { X, GitBranch, ExternalLink, Settings, Plus, Minus } from 'lucide-react';
import { ProviderSelector } from './ProviderSelector';
import { type Provider } from '../types';
import { type ProviderRun } from '../types/chat';
import { Separator } from './ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { providerMeta } from '../providers/meta';
import { isValidProviderId } from '@shared/providers/registry';
import { type LinearIssueSummary } from '../types/linear';
import { type GitHubIssueSummary } from '../types/github';
import {
  generateFriendlyWorkspaceName,
  normalizeWorkspaceName,
  MAX_WORKSPACE_NAME_LENGTH,
} from '../lib/workspaceNames';

const DEFAULT_PROVIDER: Provider = 'claude';
const MAX_PROVIDERS = 4;
const MAX_RUNS_PER_PROVIDER = 5;

import { LinearIssueSelector } from './LinearIssueSelector';
import { GitHubIssueSelector } from './GitHubIssueSelector';
import JiraIssueSelector from './JiraIssueSelector';
import { type JiraIssueSummary } from '../types/jira';
import { Badge } from './ui/badge';
import jiraLogo from '../../assets/images/jira.png';

interface WorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateWorkspace: (
    name: string,
    initialPrompt?: string,
    providerRuns?: ProviderRun[],
    linkedLinearIssue?: LinearIssueSummary | null,
    linkedGithubIssue?: GitHubIssueSummary | null,
    linkedJiraIssue?: import('../types/jira').JiraIssueSummary | null,
    autoApprove?: boolean
  ) => void;
  projectName: string;
  defaultBranch: string;
  existingNames?: string[];
  projectPath?: string;
}

const WorkspaceModal: React.FC<WorkspaceModalProps> = ({
  isOpen,
  onClose,
  onCreateWorkspace,
  projectName,
  defaultBranch,
  existingNames = [],
  projectPath,
}) => {
  const [workspaceName, setWorkspaceName] = useState('');
  const [defaultProviderFromSettings, setDefaultProviderFromSettings] =
    useState<Provider>(DEFAULT_PROVIDER);
  const [providerRuns, setProviderRuns] = useState<ProviderRun[]>([
    { provider: DEFAULT_PROVIDER, runs: 1 },
  ]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [initialPrompt, setInitialPrompt] = useState('');
  const [selectedLinearIssue, setSelectedLinearIssue] = useState<LinearIssueSummary | null>(null);
  const [selectedGithubIssue, setSelectedGithubIssue] = useState<GitHubIssueSummary | null>(null);

  const [selectedJiraIssue, setSelectedJiraIssue] = useState<JiraIssueSummary | null>(null);
  const [isJiraConnected, setIsJiraConnected] = useState<boolean | null>(null);
  const [autoApprove, setAutoApprove] = useState(false);
  const [bestOfEnabled, setBestOfEnabled] = useState(false);

  // Computed values
  const totalRuns = useMemo(
    () => providerRuns.reduce((sum, pr) => sum + pr.runs, 0),
    [providerRuns]
  );
  const activeProviders = useMemo(() => providerRuns.map((pr) => pr.provider), [providerRuns]);
  const hasAutoApproveSupport =
    activeProviders.length > 0 &&
    activeProviders.every((providerId) => !!providerMeta[providerId]?.autoApproveFlag);
  const shouldReduceMotion = useReducedMotion();

  // Provider run helpers
  const updateProviderAt = useCallback((index: number, provider: Provider) => {
    setProviderRuns((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], provider };
      return next;
    });
  }, []);

  const updateRunsAt = useCallback((index: number, runs: number) => {
    setProviderRuns((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], runs: Math.max(1, Math.min(MAX_RUNS_PER_PROVIDER, runs)) };
      return next;
    });
  }, []);

  const removeProviderAt = useCallback((index: number) => {
    setProviderRuns((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const addProvider = useCallback(() => {
    if (providerRuns.length >= MAX_PROVIDERS) return;
    // Pick a provider not already in the list, or default to 'codex'
    const usedProviders = new Set(providerRuns.map((pr) => pr.provider));
    const availableProviders: Provider[] = ['claude', 'codex', 'gemini', 'goose', 'cursor'];
    const nextProvider = availableProviders.find((p) => !usedProviders.has(p)) || 'codex';
    setProviderRuns((prev) => [...prev, { provider: nextProvider, runs: 1 }]);
  }, [providerRuns]);

  const handleBestOfToggle = useCallback((enabled: boolean) => {
    setBestOfEnabled(enabled);
    // Reset all runs to 1 when toggling
    setProviderRuns((prev) => prev.map((pr) => ({ ...pr, runs: 1 })));
  }, []);

  const normalizedExisting = useMemo(
    () => existingNames.map((n) => normalizeWorkspaceName(n)).filter(Boolean),
    [existingNames]
  );

  const validate = useCallback(
    (value: string): string | null => {
      const normalized = normalizeWorkspaceName(value);
      if (!normalized) return 'Please enter a Task name.';
      if (normalizedExisting.includes(normalized)) {
        return 'A Task with this name already exists.';
      }
      if (normalized.length > MAX_WORKSPACE_NAME_LENGTH) {
        return `Task name is too long (max ${MAX_WORKSPACE_NAME_LENGTH} characters).`;
      }
      return null;
    },
    [normalizedExisting]
  );

  const onChange = (val: string) => {
    setWorkspaceName(val);
    setError(validate(val));
  };

  useEffect(() => {
    if (!isOpen) {
      setSelectedLinearIssue(null);
      setSelectedGithubIssue(null);
      return;
    }
    if (!workspaceName) {
      const suggested = generateFriendlyWorkspaceName(normalizedExisting);
      setWorkspaceName(suggested);
      setError(validate(suggested));
      setTouched(false);
    }
  }, [isOpen, normalizedExisting, validate]);

  // Load default provider from settings when modal opens - always start fresh
  useEffect(() => {
    if (!isOpen) return;
    let cancel = false;
    (async () => {
      try {
        const res = await window.electronAPI.getSettings();
        if (cancel) return;
        const settingsProvider = res?.success ? res.settings?.defaultProvider : undefined;
        const defaultProvider: Provider = isValidProviderId(settingsProvider)
          ? (settingsProvider as Provider)
          : DEFAULT_PROVIDER;
        setDefaultProviderFromSettings(defaultProvider);
        // Always start with a single provider row using the default
        setProviderRuns([{ provider: defaultProvider, runs: 1 }]);
      } catch {
        // Ignore errors, use default provider
        setProviderRuns([{ provider: DEFAULT_PROVIDER, runs: 1 }]);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [isOpen]);

  // Check Jira connection to decide whether to render the Jira selector
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const api: any = (window as any).electronAPI;
        const res = await api?.jiraCheckConnection?.();
        if (!cancel) setIsJiraConnected(!!res?.connected);
      } catch {
        if (!cancel) setIsJiraConnected(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!hasAutoApproveSupport && autoApprove) {
      setAutoApprove(false);
    }
  }, [hasAutoApproveSupport, autoApprove]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.1, ease: 'easeOut' }}
          onClick={onClose}
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={shouldReduceMotion ? false : { opacity: 0, y: 8, scale: 0.995 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={
              shouldReduceMotion
                ? { opacity: 1, y: 0, scale: 1 }
                : { opacity: 0, y: 6, scale: 0.995 }
            }
            transition={
              shouldReduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }
            }
            className="mx-4 w-full max-w-md transform-gpu will-change-transform"
          >
            <Card className="relative max-h-[calc(100vh-48px)] w-full overflow-y-auto">
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="absolute right-2 top-2 z-10 h-8 w-8 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
              <CardHeader className="space-y-1 pb-2 pr-12">
                <CardTitle className="text-lg">New Task</CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  {projectName} • from origin/{defaultBranch}
                </CardDescription>
              </CardHeader>

              <CardContent>
                <Separator className="mb-2" />
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setTouched(true);
                    const err = validate(workspaceName);
                    if (err) {
                      setError(err);
                      return;
                    }
                    setIsCreating(true);
                    (async () => {
                      try {
                        await onCreateWorkspace(
                          normalizeWorkspaceName(workspaceName),
                          showAdvanced ? initialPrompt.trim() || undefined : undefined,
                          providerRuns,
                          selectedLinearIssue,
                          selectedGithubIssue,
                          selectedJiraIssue,
                          showAdvanced ? autoApprove : false
                        );

                        setWorkspaceName('');
                        setInitialPrompt('');
                        setProviderRuns([{ provider: defaultProviderFromSettings, runs: 1 }]);
                        setBestOfEnabled(false);
                        setSelectedLinearIssue(null);
                        setSelectedGithubIssue(null);
                        setAutoApprove(false);
                        setShowAdvanced(false);
                        setError(null);
                        onClose();
                      } catch (error) {
                        console.error('Failed to create workspace:', error);
                      } finally {
                        setIsCreating(false);
                      }
                    })();
                  }}
                  className="space-y-4"
                >
                  <div>
                    <Label htmlFor="workspace-name" className="mb-2 block">
                      Task name
                    </Label>
                    <Input
                      id="workspace-name"
                      value={workspaceName}
                      onChange={(e) => onChange(e.target.value)}
                      onBlur={() => setTouched(true)}
                      placeholder="e.g. refactorApiRoutes"
                      className={`w-full ${touched && error ? 'border-destructive focus-visible:border-destructive focus-visible:ring-destructive' : ''}`}
                      aria-invalid={touched && !!error}
                      aria-describedby="workspace-name-error"
                      autoFocus
                    />
                  </div>

                  {workspaceName && (
                    <div className="flex items-center space-x-2 rounded-lg bg-gray-100 p-3 dark:bg-gray-700">
                      <GitBranch className="h-4 w-4 flex-shrink-0 text-gray-500" />
                      <span className="overflow-hidden break-all text-sm text-gray-600 dark:text-gray-400">
                        {normalizeWorkspaceName(workspaceName)}
                      </span>
                    </div>
                  )}

                  {/* Provider rows */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>AI Provider{providerRuns.length > 1 ? 's' : ''}</Label>
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={bestOfEnabled}
                          onChange={(e) => handleBestOfToggle(e.target.checked)}
                          className="h-4 w-4"
                        />
                        <span className="text-muted-foreground">Best-of</span>
                      </label>
                    </div>
                    {providerRuns.map((pr, index) => (
                      <div key={index} className="flex items-center gap-1.5">
                        <div className="min-w-0 flex-1">
                          <ProviderSelector
                            value={pr.provider}
                            onChange={(p) => updateProviderAt(index, p)}
                            onRemove={providerRuns.length > 1 ? () => removeProviderAt(index) : undefined}
                            className="w-full"
                          />
                        </div>
                        {bestOfEnabled && (
                          <div className="flex h-9 items-center overflow-hidden rounded-md bg-gray-100 dark:bg-gray-700">
                            <button
                              type="button"
                              onClick={() => updateRunsAt(index, pr.runs - 1)}
                              disabled={pr.runs <= 1}
                              className="flex h-full w-8 items-center justify-center text-muted-foreground transition-colors hover:bg-gray-200 disabled:opacity-40 dark:hover:bg-gray-600"
                              aria-label="Decrease runs"
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <div className="h-5 w-px bg-gray-300 dark:bg-gray-600" />
                            <span
                              className="flex h-full w-8 items-center justify-center text-sm"
                              aria-label={`${pr.runs} runs for ${pr.provider}`}
                            >
                              {pr.runs}
                            </span>
                            <div className="h-5 w-px bg-gray-300 dark:bg-gray-600" />
                            <button
                              type="button"
                              onClick={() => updateRunsAt(index, pr.runs + 1)}
                              disabled={pr.runs >= MAX_RUNS_PER_PROVIDER}
                              className="flex h-full w-8 items-center justify-center text-muted-foreground transition-colors hover:bg-gray-200 disabled:opacity-40 dark:hover:bg-gray-600"
                              aria-label="Increase runs"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                    {providerRuns.length < MAX_PROVIDERS && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addProvider}
                        className="mt-1 w-full"
                      >
                        <Plus className="mr-1 h-4 w-4" />
                        Add provider
                      </Button>
                    )}
                  </div>

                  <Accordion
                    type="single"
                    collapsible
                    value={showAdvanced ? 'advanced' : undefined}
                    className="space-y-2"
                  >
                    <AccordionItem value="advanced" className="border-none">
                      <AccordionTrigger
                        className="flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border-none bg-gray-100 px-3 text-sm font-medium text-foreground hover:bg-gray-200 hover:no-underline dark:bg-gray-700 dark:hover:bg-gray-600 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0"
                        onPointerDown={(e) => {
                          // Toggle immediately on pointer down to avoid a required second click
                          // when another element inside had focus.
                          e.preventDefault();
                          setShowAdvanced((prev) => !prev);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setShowAdvanced((prev) => !prev);
                          }
                        }}
                      >
                        <span className="inline-flex items-center gap-2">
                          <Settings className="h-4 w-4 text-muted-foreground" />
                          <span>Advanced options</span>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="space-y-4 px-0 pt-2" id="workspace-advanced">
                        <div className="flex flex-col gap-4 p-2">
                          {hasAutoApproveSupport ? (
                            <div className="flex items-center gap-4">
                              <Label className="w-32 shrink-0">Auto-approve</Label>
                              <div className="min-w-0 flex-1">
                                <label className="inline-flex cursor-pointer items-start gap-2 text-sm leading-tight">
                                  <input
                                    type="checkbox"
                                    checked={autoApprove}
                                    onChange={(e) => setAutoApprove(e.target.checked)}
                                    className="mt-[1px] h-4 w-4 shrink-0"
                                  />
                                  <div className="space-y-1">
                                    <span className="text-muted-foreground">
                                      Skip permissions for file operations
                                    </span>
                                    <a
                                      href="https://simonwillison.net/2025/Oct/22/living-dangerously-with-claude/"
                                      target="_blank"
                                      rel="noreferrer noopener"
                                      className="ml-1 inline-flex items-center gap-1 text-foreground underline"
                                    >
                                      Explanation
                                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                                    </a>
                                  </div>
                                </label>
                              </div>
                            </div>
                          ) : null}
                          <div className="flex items-start gap-4">
                            <Label htmlFor="linear-issue" className="w-32 shrink-0 pt-2">
                              Linear issue
                            </Label>
                            <div className="min-w-0 flex-1">
                              <LinearIssueSelector
                                selectedIssue={selectedLinearIssue}
                                onIssueChange={(issue) => {
                                  setSelectedLinearIssue(issue);
                                  if (issue) {
                                    setSelectedGithubIssue(null);
                                    setSelectedJiraIssue(null);
                                  }
                                }}
                                isOpen={isOpen && showAdvanced}
                                disabled={!!selectedGithubIssue || !!selectedJiraIssue}
                                className="w-full"
                              />
                            </div>
                          </div>
                          <div className="flex items-start gap-4">
                            <Label htmlFor="github-issue" className="w-32 shrink-0 pt-2">
                              GitHub issue
                            </Label>
                            <div className="min-w-0 flex-1">
                              <GitHubIssueSelector
                                projectPath={projectPath || ''}
                                selectedIssue={selectedGithubIssue}
                                onIssueChange={(issue) => {
                                  setSelectedGithubIssue(issue);
                                  if (issue) {
                                    setSelectedLinearIssue(null);
                                    setSelectedJiraIssue(null);
                                  }
                                }}
                                isOpen={isOpen && showAdvanced}
                                disabled={!!selectedJiraIssue || !!selectedLinearIssue}
                                className="w-full"
                              />
                            </div>
                          </div>
                          <div className="flex items-start gap-4">
                            <Label htmlFor="jira-issue" className="w-32 shrink-0 pt-2">
                              Jira issue
                            </Label>
                            <div className="min-w-0 flex-1">
                              {isJiraConnected ? (
                                <JiraIssueSelector
                                  selectedIssue={selectedJiraIssue}
                                  onIssueChange={(issue) => {
                                    setSelectedJiraIssue(issue);
                                    if (issue) {
                                      setSelectedLinearIssue(null);
                                      setSelectedGithubIssue(null);
                                    }
                                  }}
                                  isOpen={isOpen && showAdvanced}
                                  disabled={!!selectedLinearIssue || !!selectedGithubIssue}
                                  className="w-full"
                                />
                              ) : (
                                <TooltipProvider delayDuration={150}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div className="w-full">
                                        <JiraIssueSelector
                                          selectedIssue={null}
                                          onIssueChange={() => {}}
                                          isOpen={isOpen && showAdvanced}
                                          disabled
                                          className="w-full"
                                        />
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent
                                      side="top"
                                      align="start"
                                      className="max-w-xs text-left"
                                    >
                                      <div className="flex items-center gap-2 pb-1">
                                        <Badge className="inline-flex items-center gap-1.5">
                                          <img src={jiraLogo} alt="Jira" className="h-3.5 w-3.5" />
                                          <span>Connect Jira</span>
                                        </Badge>
                                      </div>
                                      <p className="text-xs text-muted-foreground">
                                        Add your Jira site, email, and API token in Settings →
                                        Integrations to browse and attach issues here.
                                      </p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-start gap-4 p-2">
                          <Label htmlFor="initial-prompt" className="w-32 shrink-0">
                            Initial prompt
                          </Label>
                          <div className="min-w-0 flex-1">
                            <textarea
                              id="initial-prompt"
                              value={initialPrompt}
                              onChange={(e) => setInitialPrompt(e.target.value)}
                              placeholder={
                                selectedLinearIssue
                                  ? `e.g. Fix the attached Linear ticket ${selectedLinearIssue.identifier} — describe any constraints.`
                                  : selectedGithubIssue
                                    ? `e.g. Fix the attached GitHub issue #${selectedGithubIssue.number} — describe any constraints.`
                                    : selectedJiraIssue
                                      ? `e.g. Fix the attached Jira ticket ${selectedJiraIssue.key} — describe any constraints.`
                                      : `e.g. Summarize the key problems and propose a plan.`
                              }
                              className="min-h-[80px] w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none"
                              rows={3}
                            />
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>

                  <div className="flex justify-end">
                    <Button type="submit" disabled={!!validate(workspaceName) || isCreating}>
                      {isCreating ? (
                        <>
                          <Spinner size="sm" className="mr-2" />
                          Creating...
                        </>
                      ) : (
                        'Create'
                      )}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default WorkspaceModal;
