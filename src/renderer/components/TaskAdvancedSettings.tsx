import React, { useCallback, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ExternalLink, Settings } from 'lucide-react';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';
import { Spinner } from './ui/spinner';
import { Textarea } from './ui/textarea';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import { LinearIssueSelector } from './LinearIssueSelector';
import { GitHubIssueSelector } from './GitHubIssueSelector';
import JiraIssueSelector from './JiraIssueSelector';
import { GitLabIssueSelector } from './GitLabIssueSelector';
import { PlainThreadSelector } from './PlainThreadSelector';
import LinearSetupForm from './integrations/LinearSetupForm';
import JiraSetupForm from './integrations/JiraSetupForm';
import GitLabSetupForm from './integrations/GitLabSetupForm';
import PlainSetupForm from './integrations/PlainSetupForm';
import { type LinearIssueSummary } from '../types/linear';
import { type GitHubIssueSummary } from '../types/github';
import { type GitHubIssueLink } from '../types/chat';
import { type JiraIssueSummary } from '../types/jira';
import { type GitLabIssueSummary } from '../types/gitlab';
import { type PlainThreadSummary } from '../types/plain';

interface TaskAdvancedSettingsProps {
  isOpen: boolean;
  projectPath?: string;

  // Worktree
  useWorktree: boolean;
  onUseWorktreeChange: (value: boolean) => void;

  // Auto-approve
  autoApprove: boolean;
  onAutoApproveChange: (value: boolean) => void;
  hasAutoApproveSupport: boolean;

  // Initial prompt
  initialPrompt: string;
  onInitialPromptChange: (value: string) => void;
  hasInitialPromptSupport: boolean;

  // Linear
  selectedLinearIssue: LinearIssueSummary | null;
  onLinearIssueChange: (issue: LinearIssueSummary | null) => void;
  isLinearConnected: boolean | null;
  onLinearConnect: (apiKey: string) => Promise<void>;

  // GitHub
  selectedGithubIssue: GitHubIssueSummary | null;
  onGithubIssueChange: (issue: GitHubIssueSummary | null) => void;
  linkedGithubIssueMap?: ReadonlyMap<number, GitHubIssueLink>;
  isGithubConnected: boolean;
  onGithubConnect: () => Promise<void>;
  githubLoading: boolean;
  githubInstalled: boolean;

  // Jira
  selectedJiraIssue: JiraIssueSummary | null;
  onJiraIssueChange: (issue: JiraIssueSummary | null) => void;
  isJiraConnected: boolean | null;
  onJiraConnect: (credentials: { siteUrl: string; email: string; token: string }) => Promise<void>;

  // GitLab
  selectedGitlabIssue: GitLabIssueSummary | null;
  onGitlabIssueChange: (issue: GitLabIssueSummary | null) => void;
  isGitlabConnected: boolean | null;
  onGitlabConnect: (credentials: { instanceUrl: string; token: string }) => Promise<void>;

  // Plain
  selectedPlainThread: PlainThreadSummary | null;
  onPlainThreadChange: (thread: PlainThreadSummary | null) => void;
  isPlainConnected: boolean | null;
  onPlainConnect: (apiKey: string) => Promise<void>;
}

export const TaskAdvancedSettings: React.FC<TaskAdvancedSettingsProps> = ({
  isOpen,
  projectPath,
  useWorktree,
  onUseWorktreeChange,
  autoApprove,
  onAutoApproveChange,
  hasAutoApproveSupport,
  initialPrompt,
  onInitialPromptChange,
  hasInitialPromptSupport,
  selectedLinearIssue,
  onLinearIssueChange,
  isLinearConnected,
  onLinearConnect,
  selectedGithubIssue,
  onGithubIssueChange,
  linkedGithubIssueMap,
  isGithubConnected,
  onGithubConnect,
  githubLoading,
  githubInstalled,
  selectedJiraIssue,
  onJiraIssueChange,
  isJiraConnected,
  onJiraConnect,
  selectedGitlabIssue,
  onGitlabIssueChange,
  isGitlabConnected,
  onGitlabConnect,
  selectedPlainThread,
  onPlainThreadChange,
  isPlainConnected,
  onPlainConnect,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Linear setup state
  const [linearSetupOpen, setLinearSetupOpen] = useState(false);
  const [linearApiKey, setLinearApiKey] = useState('');
  const [linearConnectionError, setLinearConnectionError] = useState<string | null>(null);
  const [autoOpenLinearSelector, setAutoOpenLinearSelector] = useState(false);

  // Jira setup state
  const [jiraSetupOpen, setJiraSetupOpen] = useState(false);
  const [jiraSite, setJiraSite] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraToken, setJiraToken] = useState('');
  const [jiraConnectionError, setJiraConnectionError] = useState<string | null>(null);

  // GitLab setup state
  const [gitlabSetupOpen, setGitlabSetupOpen] = useState(false);
  const [gitlabInstanceUrl, setGitlabInstanceUrl] = useState('');
  const [gitlabToken, setGitlabToken] = useState('');
  const [gitlabConnectionError, setGitlabConnectionError] = useState<string | null>(null);

  // Plain setup state
  const [plainSetupOpen, setPlainSetupOpen] = useState(false);
  const [plainApiKey, setPlainApiKey] = useState('');
  const [plainConnectionError, setPlainConnectionError] = useState<string | null>(null);
  const [autoOpenPlainSelector, setAutoOpenPlainSelector] = useState(false);

  const handleLinearConnect = useCallback(async () => {
    const trimmedKey = linearApiKey.trim();
    if (!trimmedKey) return;

    setLinearConnectionError(null);
    try {
      await onLinearConnect(trimmedKey);
      setLinearSetupOpen(false);
      setLinearApiKey('');
      setAutoOpenLinearSelector(true);
    } catch (error: any) {
      setLinearConnectionError(error?.message || 'Could not connect Linear. Try again.');
    }
  }, [linearApiKey, onLinearConnect]);

  const handleJiraConnect = useCallback(async () => {
    setJiraConnectionError(null);
    try {
      await onJiraConnect({
        siteUrl: jiraSite.trim(),
        email: jiraEmail.trim(),
        token: jiraToken.trim(),
      });
      setJiraSetupOpen(false);
      setJiraSite('');
      setJiraEmail('');
      setJiraToken('');
    } catch (error: any) {
      setJiraConnectionError(error?.message || 'Failed to connect.');
    }
  }, [jiraSite, jiraEmail, jiraToken, onJiraConnect]);

  const handleGitlabConnect = useCallback(async () => {
    setGitlabConnectionError(null);
    try {
      await onGitlabConnect({
        instanceUrl: gitlabInstanceUrl.trim(),
        token: gitlabToken.trim(),
      });
      setGitlabSetupOpen(false);
      setGitlabInstanceUrl('');
      setGitlabToken('');
    } catch (error: any) {
      setGitlabConnectionError(error?.message || 'Failed to connect.');
    }
  }, [gitlabInstanceUrl, gitlabToken, onGitlabConnect]);

  const handlePlainConnect = useCallback(async () => {
    const trimmedKey = plainApiKey.trim();
    if (!trimmedKey) return;

    setPlainConnectionError(null);
    try {
      await onPlainConnect(trimmedKey);
      setPlainSetupOpen(false);
      setPlainApiKey('');
      setAutoOpenPlainSelector(true);
    } catch (error: any) {
      setPlainConnectionError(error?.message || 'Could not connect Plain. Try again.');
    }
  }, [plainApiKey, onPlainConnect]);

  const handleLinearIssueChange = useCallback(
    (issue: LinearIssueSummary | null) => {
      onLinearIssueChange(issue);
      if (issue) {
        onGithubIssueChange(null);
        onJiraIssueChange(null);
        onGitlabIssueChange(null);
        onPlainThreadChange(null);
      }
    },
    [
      onLinearIssueChange,
      onGithubIssueChange,
      onJiraIssueChange,
      onGitlabIssueChange,
      onPlainThreadChange,
    ]
  );

  const handleGithubIssueChange = useCallback(
    (issue: GitHubIssueSummary | null) => {
      onGithubIssueChange(issue);
      if (issue) {
        onLinearIssueChange(null);
        onJiraIssueChange(null);
        onGitlabIssueChange(null);
        onPlainThreadChange(null);
      }
    },
    [
      onGithubIssueChange,
      onLinearIssueChange,
      onJiraIssueChange,
      onGitlabIssueChange,
      onPlainThreadChange,
    ]
  );

  const handleJiraIssueChange = useCallback(
    (issue: JiraIssueSummary | null) => {
      onJiraIssueChange(issue);
      if (issue) {
        onLinearIssueChange(null);
        onGithubIssueChange(null);
        onGitlabIssueChange(null);
        onPlainThreadChange(null);
      }
    },
    [
      onJiraIssueChange,
      onLinearIssueChange,
      onGithubIssueChange,
      onGitlabIssueChange,
      onPlainThreadChange,
    ]
  );

  const handleGitlabIssueChange = useCallback(
    (issue: GitLabIssueSummary | null) => {
      onGitlabIssueChange(issue);
      if (issue) {
        onLinearIssueChange(null);
        onGithubIssueChange(null);
        onJiraIssueChange(null);
        onPlainThreadChange(null);
      }
    },
    [
      onGitlabIssueChange,
      onLinearIssueChange,
      onGithubIssueChange,
      onJiraIssueChange,
      onPlainThreadChange,
    ]
  );

  const handlePlainThreadChange = useCallback(
    (thread: PlainThreadSummary | null) => {
      onPlainThreadChange(thread);
      if (thread) {
        onLinearIssueChange(null);
        onGithubIssueChange(null);
        onJiraIssueChange(null);
        onGitlabIssueChange(null);
      }
    },
    [
      onPlainThreadChange,
      onLinearIssueChange,
      onGithubIssueChange,
      onJiraIssueChange,
      onGitlabIssueChange,
    ]
  );

  const getInitialPromptPlaceholder = () => {
    if (!hasInitialPromptSupport) {
      return 'Selected provider does not support initial prompts';
    }
    if (selectedLinearIssue) {
      return `e.g. Fix the attached Linear ticket ${selectedLinearIssue.identifier} — describe any constraints.`;
    }
    if (selectedGithubIssue) {
      return `e.g. Fix the attached GitHub issue #${selectedGithubIssue.number} — describe any constraints.`;
    }
    if (selectedJiraIssue) {
      return `e.g. Fix the attached Jira ticket ${selectedJiraIssue.key} — describe any constraints.`;
    }
    if (selectedGitlabIssue) {
      return `e.g. Fix the attached GitLab issue #${selectedGitlabIssue.iid} — describe any constraints.`;
    }
    if (selectedPlainThread) {
      return `e.g. Fix the customer-reported issue "${selectedPlainThread.title}" — describe any constraints.`;
    }
    return 'e.g. Summarize the key problems and propose a plan.';
  };

  return (
    <>
      <Accordion
        type="single"
        collapsible
        value={showAdvanced ? 'advanced' : undefined}
        className="space-y-2"
      >
        <AccordionItem value="advanced" className="border-none">
          <AccordionTrigger
            className="flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border-none bg-muted px-3 text-sm font-medium text-foreground hover:bg-accent hover:no-underline [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0"
            onPointerDown={(e) => {
              e.preventDefault();
              const wasClosed = !showAdvanced;
              setShowAdvanced((prev) => !prev);
              if (wasClosed) {
                void (async () => {
                  const { captureTelemetry } = await import('../lib/telemetryClient');
                  captureTelemetry('task_advanced_options_opened');
                })();
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const wasClosed = !showAdvanced;
                setShowAdvanced((prev) => !prev);
                if (wasClosed) {
                  void (async () => {
                    const { captureTelemetry } = await import('../lib/telemetryClient');
                    captureTelemetry('task_advanced_options_opened');
                  })();
                }
              }
            }}
          >
            <span className="inline-flex items-center gap-2">
              <Settings className="h-4 w-4 text-muted-foreground" />
              <span>Advanced options</span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 overflow-hidden px-0 pt-2" id="task-advanced">
            <div className="flex flex-col gap-4 p-2">
              <div className="flex items-center gap-4">
                <Label className="w-32 shrink-0">Run in worktree</Label>
                <div className="min-w-0 flex-1">
                  <label className="inline-flex cursor-pointer items-start gap-2 text-sm leading-tight">
                    <Checkbox
                      checked={useWorktree}
                      onCheckedChange={(checked) => onUseWorktreeChange(checked === true)}
                      className="mt-[1px]"
                    />
                    <div className="space-y-1">
                      <span className="text-muted-foreground">
                        {useWorktree
                          ? 'Create isolated Git worktree (recommended)'
                          : 'Work directly on current branch'}
                      </span>
                      {!useWorktree && (
                        <p className="text-xs text-destructive">
                          ⚠️ Changes will affect your current working directory
                        </p>
                      )}
                    </div>
                  </label>
                </div>
              </div>

              {hasAutoApproveSupport ? (
                <div className="flex items-center gap-4">
                  <Label className="w-32 shrink-0">Auto-approve</Label>
                  <div className="min-w-0 flex-1">
                    <label className="inline-flex cursor-pointer items-start gap-2 text-sm leading-tight">
                      <Checkbox
                        checked={autoApprove}
                        onCheckedChange={(checked) => onAutoApproveChange(checked === true)}
                        className="mt-[1px]"
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

              <div className="grid grid-cols-[128px_1fr] items-start gap-4">
                <Label htmlFor="linear-issue" className="pt-2">
                  Linear issue
                </Label>
                <div className="flex min-w-0 items-center gap-2">
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <LinearIssueSelector
                      selectedIssue={selectedLinearIssue}
                      onIssueChange={handleLinearIssueChange}
                      isOpen={isOpen}
                      disabled={
                        !hasInitialPromptSupport ||
                        !isLinearConnected ||
                        !!selectedGithubIssue ||
                        !!selectedJiraIssue ||
                        !!selectedGitlabIssue ||
                        !!selectedPlainThread
                      }
                      className="w-full"
                      autoOpen={autoOpenLinearSelector}
                      onAutoOpenHandled={() => setAutoOpenLinearSelector(false)}
                      placeholder={isLinearConnected ? 'Select a Linear issue' : 'Select issue'}
                    />
                  </div>
                  {!isLinearConnected && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9 shrink-0 whitespace-nowrap border-border/50 bg-transparent text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground"
                      onClick={() => setLinearSetupOpen(true)}
                    >
                      Connect
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-[128px_1fr] items-start gap-4">
                <Label htmlFor="github-issue" className="pt-2">
                  GitHub issue
                </Label>
                <div className="flex min-w-0 items-center gap-2">
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <GitHubIssueSelector
                      projectPath={projectPath || ''}
                      selectedIssue={selectedGithubIssue}
                      onIssueChange={handleGithubIssueChange}
                      linkedIssueMap={linkedGithubIssueMap}
                      isOpen={isOpen}
                      disabled={
                        !hasInitialPromptSupport ||
                        !isGithubConnected ||
                        !!selectedJiraIssue ||
                        !!selectedLinearIssue ||
                        !!selectedGitlabIssue ||
                        !!selectedPlainThread
                      }
                      className="w-full"
                      placeholder={isGithubConnected ? 'Select a GitHub issue' : 'Select issue'}
                    />
                  </div>
                  {!isGithubConnected && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9 shrink-0 whitespace-nowrap border-border/50 bg-transparent text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground"
                      onClick={() => void onGithubConnect()}
                      disabled={githubLoading}
                    >
                      {githubLoading ? (
                        <>
                          <Spinner size="sm" className="mr-1" />
                          Connecting...
                        </>
                      ) : !githubInstalled ? (
                        'Install CLI'
                      ) : (
                        'Connect'
                      )}
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-[128px_1fr] items-start gap-4">
                <Label htmlFor="jira-issue" className="pt-2">
                  Jira issue
                </Label>
                <div className="flex min-w-0 items-center gap-2">
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <JiraIssueSelector
                      selectedIssue={selectedJiraIssue}
                      onIssueChange={handleJiraIssueChange}
                      isOpen={isOpen}
                      disabled={
                        !hasInitialPromptSupport ||
                        !isJiraConnected ||
                        !!selectedLinearIssue ||
                        !!selectedGithubIssue ||
                        !!selectedGitlabIssue ||
                        !!selectedPlainThread
                      }
                      className="w-full"
                      placeholder={isJiraConnected ? 'Select a Jira issue' : 'Select issue'}
                    />
                  </div>
                  {!isJiraConnected && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9 shrink-0 whitespace-nowrap border-border/50 bg-transparent text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground"
                      onClick={() => setJiraSetupOpen(true)}
                    >
                      Connect
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-[128px_1fr] items-start gap-4">
                <Label htmlFor="gitlab-issue" className="pt-2">
                  GitLab issue
                </Label>
                <div className="flex min-w-0 items-center gap-2">
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <GitLabIssueSelector
                      projectPath={projectPath || ''}
                      selectedIssue={selectedGitlabIssue}
                      onIssueChange={handleGitlabIssueChange}
                      isOpen={isOpen}
                      disabled={
                        !hasInitialPromptSupport ||
                        !isGitlabConnected ||
                        !!selectedLinearIssue ||
                        !!selectedGithubIssue ||
                        !!selectedJiraIssue ||
                        !!selectedPlainThread
                      }
                      className="w-full"
                      placeholder={isGitlabConnected ? 'Select a GitLab issue' : 'Select issue'}
                    />
                  </div>
                  {!isGitlabConnected && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9 shrink-0 whitespace-nowrap border-border/50 bg-transparent text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground"
                      onClick={() => setGitlabSetupOpen(true)}
                    >
                      Connect
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-[128px_1fr] items-start gap-4">
                <Label htmlFor="plain-thread" className="pt-2">
                  Plain thread
                </Label>
                <div className="flex min-w-0 items-center gap-2">
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <PlainThreadSelector
                      selectedThread={selectedPlainThread}
                      onThreadChange={handlePlainThreadChange}
                      isOpen={isOpen}
                      disabled={
                        !hasInitialPromptSupport ||
                        !isPlainConnected ||
                        !!selectedLinearIssue ||
                        !!selectedGithubIssue ||
                        !!selectedJiraIssue ||
                        !!selectedGitlabIssue
                      }
                      className="w-full"
                      autoOpen={autoOpenPlainSelector}
                      onAutoOpenHandled={() => setAutoOpenPlainSelector(false)}
                      placeholder={isPlainConnected ? 'Select a Plain thread' : 'Select thread'}
                    />
                  </div>
                  {!isPlainConnected && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9 shrink-0 whitespace-nowrap border-border/50 bg-transparent text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground"
                      onClick={() => setPlainSetupOpen(true)}
                    >
                      Connect
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-start gap-4 p-2">
              <Label htmlFor="initial-prompt" className="w-32 shrink-0">
                Initial prompt
              </Label>
              <div className="min-w-0 flex-1">
                <Textarea
                  id="initial-prompt"
                  value={initialPrompt}
                  onChange={(e) => onInitialPromptChange(e.target.value)}
                  disabled={!hasInitialPromptSupport}
                  placeholder={getInitialPromptPlaceholder()}
                  className="resize-none"
                  rows={3}
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <AnimatePresence>
        {linearSetupOpen ? (
          <motion.div
            className="fixed inset-0 z-[1000] flex items-center justify-center px-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLinearSetupOpen(false)}
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div
              className="relative z-10 w-full max-w-md rounded-xl border border-border/70 bg-background/95 p-4 shadow-2xl backdrop-blur-sm"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.15 }}
              onClick={(event) => event.stopPropagation()}
            >
              <LinearSetupForm
                apiKey={linearApiKey}
                onChange={(value) => setLinearApiKey(value)}
                onSubmit={() => void handleLinearConnect()}
                onClose={() => setLinearSetupOpen(false)}
                canSubmit={!!linearApiKey.trim()}
                error={linearConnectionError}
              />
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {jiraSetupOpen ? (
          <motion.div
            className="fixed inset-0 z-[1000] flex items-center justify-center px-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setJiraSetupOpen(false)}
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div
              className="relative z-10 w-full max-w-md rounded-xl border border-border/70 bg-background/95 p-4 shadow-2xl backdrop-blur-sm"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.15 }}
              onClick={(event) => event.stopPropagation()}
            >
              <JiraSetupForm
                site={jiraSite}
                email={jiraEmail}
                token={jiraToken}
                onChange={(u) => {
                  if (typeof u.site === 'string') setJiraSite(u.site);
                  if (typeof u.email === 'string') setJiraEmail(u.email);
                  if (typeof u.token === 'string') setJiraToken(u.token);
                }}
                onClose={() => setJiraSetupOpen(false)}
                canSubmit={!!(jiraSite.trim() && jiraEmail.trim() && jiraToken.trim())}
                error={jiraConnectionError}
                onSubmit={() => void handleJiraConnect()}
              />
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {gitlabSetupOpen ? (
          <motion.div
            className="fixed inset-0 z-[1000] flex items-center justify-center px-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setGitlabSetupOpen(false)}
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div
              className="relative z-10 w-full max-w-md rounded-xl border border-border/70 bg-background/95 p-4 shadow-2xl backdrop-blur-sm"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.15 }}
              onClick={(event) => event.stopPropagation()}
            >
              <GitLabSetupForm
                instanceUrl={gitlabInstanceUrl}
                token={gitlabToken}
                onChange={(u) => {
                  if (typeof u.instanceUrl === 'string') setGitlabInstanceUrl(u.instanceUrl);
                  if (typeof u.token === 'string') setGitlabToken(u.token);
                }}
                onClose={() => setGitlabSetupOpen(false)}
                canSubmit={!!(gitlabInstanceUrl.trim() && gitlabToken.trim())}
                error={gitlabConnectionError}
                onSubmit={() => void handleGitlabConnect()}
              />
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {plainSetupOpen ? (
          <motion.div
            className="fixed inset-0 z-[1000] flex items-center justify-center px-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPlainSetupOpen(false)}
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div
              className="relative z-10 w-full max-w-md rounded-xl border border-border/70 bg-background/95 p-4 shadow-2xl backdrop-blur-sm"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.15 }}
              onClick={(event) => event.stopPropagation()}
            >
              <PlainSetupForm
                apiKey={plainApiKey}
                onChange={(value) => setPlainApiKey(value)}
                onSubmit={() => void handlePlainConnect()}
                onClose={() => setPlainSetupOpen(false)}
                canSubmit={!!plainApiKey.trim()}
                error={plainConnectionError}
              />
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
};

export default TaskAdvancedSettings;
