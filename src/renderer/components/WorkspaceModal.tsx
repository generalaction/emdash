import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Spinner } from './ui/spinner';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import { X, GitBranch, ExternalLink, Info } from 'lucide-react';
import { ProviderSelector } from './ProviderSelector';
import { type Provider } from '../types';
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

const DEFAULT_PROVIDER: Provider = 'codex';
import { LinearIssueSelector } from './LinearIssueSelector';
import { GitHubIssueSelector } from './GitHubIssueSelector';
import JiraIssueSelector from './JiraIssueSelector';
import { type JiraIssueSummary } from '../types/jira';
import { Badge } from './ui/badge';
import jiraLogo from '../../assets/images/jira.png';
import MultiProviderMenu from './MultiProviderMenu';

interface WorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateWorkspace: (
    name: string,
    initialPrompt?: string,
    selectedProvider?: Provider,
    linkedLinearIssue?: LinearIssueSummary | null,
    linkedGithubIssue?: GitHubIssueSummary | null,
    linkedJiraIssue?: import('../types/jira').JiraIssueSummary | null,
    multiAgent?: {
      enabled: boolean;
      providers: Provider[];
      maxProviders?: number;
      runsPerProvider?: number;
    } | null,
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
  const [selectedProvider, setSelectedProvider] = useState<Provider>(DEFAULT_PROVIDER);
  const [multiEnabled, setMultiEnabled] = useState(false);
  const [selectedProviders, setSelectedProviders] = useState<Provider[]>([
    DEFAULT_PROVIDER,
    'claude',
  ]);
  const maxProviders = 4;
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
  const [runsPerProvider, setRunsPerProvider] = useState(1);
  const activeProviders = multiEnabled ? selectedProviders : [selectedProvider];
  const hasAutoApproveSupport =
    activeProviders.length > 0 &&
    activeProviders.every((providerId) => !!providerMeta[providerId]?.autoApproveFlag);
  const shouldReduceMotion = useReducedMotion();

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

  // Load default provider from settings when modal opens
  useEffect(() => {
    if (!isOpen) return;
    let cancel = false;
    (async () => {
      try {
        const res = await window.electronAPI.getSettings();
        if (cancel) return;
        const settingsProvider = res?.success ? res.settings?.defaultProvider : undefined;
        const provider: Provider = isValidProviderId(settingsProvider)
          ? (settingsProvider as Provider)
          : DEFAULT_PROVIDER;
        setDefaultProviderFromSettings(provider);
        setSelectedProvider(provider);
        // Also update multi-provider default - replace default provider in the list
        setSelectedProviders((prev) => {
          const newProviders = [...prev];
          const defaultIndex = newProviders.indexOf(DEFAULT_PROVIDER);
          if (defaultIndex !== -1) {
            newProviders[defaultIndex] = provider;
          }
          return newProviders;
        });
      } catch {
        // Ignore errors, use default provider
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
            <Card className="relative w-full">
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
                          selectedProvider,
                          selectedLinearIssue,
                          selectedGithubIssue,
                          selectedJiraIssue,
                          multiEnabled
                            ? {
                                enabled: true,
                                providers: selectedProviders.slice(0, maxProviders),
                                maxProviders,
                                runsPerProvider,
                              }
                            : null,
                          showAdvanced ? autoApprove : false
                        );
                        setWorkspaceName('');
                        setInitialPrompt('');
                        setSelectedProvider(defaultProviderFromSettings);
                        setSelectedProviders([defaultProviderFromSettings, 'claude']);
                        setMultiEnabled(false);
                        setRunsPerProvider(1);
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

                  <div className="flex items-center gap-4">
                    <Label htmlFor="provider-selector" className="w-32 shrink-0">
                      AI provider
                    </Label>
                    <div className="min-w-0 flex-1">
                      {!multiEnabled ? (
                        <ProviderSelector
                          value={selectedProvider}
                          onChange={setSelectedProvider}
                          className="w-full"
                        />
                      ) : (
                        <MultiProviderMenu
                          value={selectedProviders}
                          onChange={setSelectedProviders}
                          max={maxProviders}
                          className="w-full"
                        />
                      )}
                    </div>
                  </div>

                  <Accordion
                    type="single"
                    collapsible
                    value={showAdvanced ? 'advanced' : undefined}
                    className="space-y-2"
                  >
                    <AccordionItem value="advanced" className="border-none">
                      <AccordionTrigger
                        className="px-0 py-1 text-sm font-medium text-muted-foreground hover:no-underline"
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
                        Advanced options
                      </AccordionTrigger>
                      <AccordionContent className="space-y-4 px-0 pt-2" id="workspace-advanced">
                        <div className="flex flex-col gap-4">
                          <div className="flex items-center gap-4">
                            <Label className="w-32 shrink-0">Multiple agents</Label>
                            <div className="min-w-0 flex-1">
                              <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={multiEnabled}
                                  onChange={(e) => setMultiEnabled(e.target.checked)}
                                  className="h-4 w-4"
                                />
                                <span className="text-muted-foreground">
                                  Run a task across multiple agents
                                </span>
                              </label>
                            </div>
                          </div>
                          {multiEnabled && (
                            <div className="flex items-center gap-4">
                              <Label
                                htmlFor="runs-per-provider"
                                className="flex w-32 shrink-0 items-center gap-1"
                              >
                                Runs per provider
                              </Label>
                              <div className="flex min-w-0 flex-1 flex-row items-center gap-3">
                                <Input
                                  id="runs-per-provider"
                                  type="number"
                                  min="1"
                                  max="5"
                                  value={runsPerProvider}
                                  onChange={(e) =>
                                    setRunsPerProvider(
                                      Math.max(1, Math.min(5, parseInt(e.target.value) || 1))
                                    )
                                  }
                                  className="w-16"
                                />
                                <TooltipProvider delayDuration={150}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p className="text-xs">
                                        Run each provider 1-5 times for best-of-N comparison
                                      </p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </div>
                            </div>
                          )}
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
                                      Bypass permission prompts for file operations
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
                                <div className="rounded-md border border-border bg-muted/40 p-2">
                                  <div className="flex items-center gap-2">
                                    <Badge className="inline-flex items-center gap-1.5">
                                      <img src={jiraLogo} alt="Jira" className="h-3.5 w-3.5" />
                                      <span>Connect Jira</span>
                                    </Badge>
                                  </div>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Add your Jira site, email, and API token in Settings →
                                    Integrations to browse and attach issues here.
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-start gap-4">
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
