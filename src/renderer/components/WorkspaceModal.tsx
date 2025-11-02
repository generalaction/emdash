import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Spinner } from './ui/spinner';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import { X, GitBranch } from 'lucide-react';
import { ProviderSelector } from './ProviderSelector';
import { type Provider } from '../types';
import { Separator } from './ui/separator';
import { type LinearIssueSummary } from '../types/linear';
import { type GitHubIssueSummary } from '../types/github';
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
    multiAgent?: { enabled: boolean; providers: Provider[]; maxProviders?: number } | null
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
  const [selectedProvider, setSelectedProvider] = useState<Provider>('codex');
  const [multiEnabled, setMultiEnabled] = useState(false);
  const [selectedProviders, setSelectedProviders] = useState<Provider[]>(['codex', 'claude']);
  const maxProviders = 4; // limit for multi-agent selection
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [initialPrompt, setInitialPrompt] = useState('');
  const [selectedLinearIssue, setSelectedLinearIssue] = useState<LinearIssueSummary | null>(null);
  const [selectedGithubIssue, setSelectedGithubIssue] = useState<GitHubIssueSummary | null>(null);

  const [selectedJiraIssue, setSelectedJiraIssue] = useState<JiraIssueSummary | null>(null);
  const [isJiraConnected, setIsJiraConnected] = useState<boolean | null>(null);
  const shouldReduceMotion = useReducedMotion();

  const normalizedExisting = existingNames.map((n) => n.toLowerCase());

  // Convert input to valid workspace name format
  const convertToWorkspaceName = (input: string): string => {
    return input
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/[^a-z0-9-]/g, '') // Remove invalid characters
      .replace(/-+/g, '-') // Replace multiple consecutive hyphens with single hyphen
      .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
  };

  const validate = (value: string): string | null => {
    const name = value.trim();
    if (!name) return 'Please enter a workspace name.';

    const convertedName = convertToWorkspaceName(name);
    if (!convertedName) return 'Please enter a valid workspace name.';

    if (normalizedExisting.includes(convertedName)) {
      return 'A workspace with this name already exists.';
    }
    if (convertedName.length > 64) {
      return 'Name is too long (max 64 characters).';
    }
    return null;
  };

  const onChange = (val: string) => {
    if (!touched) setTouched(true);
    setWorkspaceName(val);
    setError(validate(val));
  };

  useEffect(() => {
    if (!isOpen) {
      setSelectedLinearIssue(null);
      setSelectedGithubIssue(null);
    }
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
                <CardTitle className="text-lg">New Workspace</CardTitle>
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
                          convertToWorkspaceName(workspaceName),
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
                              }
                            : null
                        );
                        setWorkspaceName('');
                        setInitialPrompt('');
                        setSelectedProvider('codex');
                        setSelectedProviders(['codex', 'claude']);
                        setMultiEnabled(false);
                        setSelectedLinearIssue(null);
                        setSelectedGithubIssue(null);
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
                    <label
                      htmlFor="workspace-name"
                      className="block text-sm font-medium text-foreground"
                    >
                      Task name
                    </label>
                    <Input
                      id="workspace-name"
                      value={workspaceName}
                      onChange={(e) => onChange(e.target.value)}
                      onBlur={() => setTouched(true)}
                      placeholder="e.g. refactorApiRoutes"
                      className="w-full"
                      aria-invalid={touched && !!error}
                      aria-describedby="workspace-name-error"
                      autoFocus
                    />
                    {touched && error && (
                      <p id="workspace-name-error" className="mt-2 text-sm text-destructive">
                        {error}
                      </p>
                    )}
                  </div>

                  {workspaceName && (
                    <div className="flex items-center space-x-2 rounded-lg bg-gray-100 p-3 dark:bg-gray-700">
                      <GitBranch className="h-4 w-4 flex-shrink-0 text-gray-500" />
                      <span className="overflow-hidden break-all text-sm text-gray-600 dark:text-gray-400">
                        {convertToWorkspaceName(workspaceName)}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-4">
                    <label
                      htmlFor="provider-selector"
                      className="w-32 shrink-0 text-sm font-medium text-foreground"
                    >
                      AI provider
                    </label>
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
                            <label className="w-32 shrink-0 text-sm font-medium text-foreground">
                              Multiple agents
                            </label>
                            <div className="min-w-0 flex-1">
                              <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={multiEnabled}
                                  onChange={(e) => setMultiEnabled(e.target.checked)}
                                  className="h-4 w-4"
                                />
                                <span className="text-muted-foreground">
                                  Run a task across multiple providers
                                </span>
                              </label>
                            </div>
                          </div>
                          <div className="flex items-start gap-4">
                            <label
                              htmlFor="linear-issue"
                              className="w-32 shrink-0 pt-2 text-sm font-medium text-foreground"
                            >
                              Linear issue
                            </label>
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
                            <label
                              htmlFor="github-issue"
                              className="w-32 shrink-0 pt-2 text-sm font-medium text-foreground"
                            >
                              GitHub issue
                            </label>
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
                            <label
                              htmlFor="jira-issue"
                              className="w-32 shrink-0 pt-2 text-sm font-medium text-foreground"
                            >
                              Jira issue
                            </label>
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
                          <label
                            htmlFor="initial-prompt"
                            className="w-32 shrink-0 text-sm font-medium text-foreground"
                          >
                            Initial prompt
                          </label>
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
