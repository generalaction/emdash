import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Spinner } from './ui/spinner';
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from './ui/dialog';
import type { BaseModalProps } from '@/contexts/ModalProvider';
import { SlugInput } from './ui/slug-input';
import { Label } from './ui/label';
import { MultiAgentDropdown } from './MultiAgentDropdown';
import { TaskAdvancedSettings } from './TaskAdvancedSettings';
import { useIntegrationStatus } from './hooks/useIntegrationStatus';
import { type Agent } from '../types';
import { type AgentRun } from '../types/chat';
import { agentMeta } from '../providers/meta';
import { isValidProviderId } from '@shared/providers/registry';
import { type LinearIssueSummary } from '../types/linear';
import { type GitHubIssueSummary } from '../types/github';
import { type JiraIssueSummary } from '../types/jira';
import { type GitLabIssueSummary } from '../types/gitlab';
import { type PlainThreadSummary } from '../types/plain';
import { type ForgejoIssueSummary } from '../types/forgejo';
import {
  generateFriendlyTaskName,
  normalizeTaskName,
  MAX_TASK_NAME_LENGTH,
} from '../lib/taskNames';
import BranchSelect, { pickDefaultBranch } from './BranchSelect';
import { generateTaskNameFromContext } from '../lib/branchNameGenerator';
import type { Project, Task } from '../types/app';
import { useProjectManagementContext } from '../contexts/ProjectManagementProvider';
import { useTaskManagementContext } from '../contexts/TaskManagementContext';
import { parsePrInput } from '../lib/parsePrInput';
import { useToast } from '../hooks/use-toast';
import { rpc } from '@/lib/rpc';
import { useFeatureFlag } from '../hooks/useFeatureFlag';

const DEFAULT_AGENT: Agent = 'claude';

export interface CreateTaskResult {
  name: string;
  initialPrompt?: string;
  agentRuns?: AgentRun[];
  linkedLinearIssue?: LinearIssueSummary | null;
  linkedGithubIssue?: GitHubIssueSummary | null;
  linkedJiraIssue?: JiraIssueSummary | null;
  linkedPlainThread?: PlainThreadSummary | null;
  linkedGitlabIssue?: GitLabIssueSummary | null;
  linkedForgejoIssue?: ForgejoIssueSummary | null;
  autoApprove?: boolean;
  useWorktree?: boolean;
  baseRef?: string;
  nameGenerated?: boolean;
  /** When true, provision a remote workspace instead of creating a local worktree. */
  useRemoteWorkspace?: boolean;
  /** Workspace provider commands — required when useRemoteWorkspace is true. */
  workspaceProvider?: {
    provisionCommand: string;
    terminateCommand: string;
  };
}

interface TaskModalProps {
  onClose: () => void;
  initialProject?: Project;
  onCreateTask: (
    name: string,
    initialPrompt?: string,
    agentRuns?: AgentRun[],
    linkedLinearIssue?: LinearIssueSummary | null,
    linkedGithubIssue?: GitHubIssueSummary | null,
    linkedJiraIssue?: JiraIssueSummary | null,
    linkedPlainThread?: PlainThreadSummary | null,
    linkedGitlabIssue?: GitLabIssueSummary | null,
    linkedForgejoIssue?: ForgejoIssueSummary | null,
    autoApprove?: boolean,
    useWorktree?: boolean,
    baseRef?: string,
    nameGenerated?: boolean,
    useRemoteWorkspace?: boolean,
    workspaceProvider?: { provisionCommand: string; terminateCommand: string }
  ) => Promise<void>;
}

export type TaskModalOverlayProps = BaseModalProps<CreateTaskResult> & {
  initialProject?: Project;
};

export function TaskModalOverlay({ onClose, initialProject }: TaskModalOverlayProps) {
  const { handleCreateTask } = useTaskManagementContext();

  return (
    <TaskModal
      onClose={onClose}
      initialProject={initialProject}
      onCreateTask={async (
        name,
        initialPrompt,
        agentRuns,
        linkedLinearIssue,
        linkedGithubIssue,
        linkedJiraIssue,
        linkedPlainThread,
        linkedGitlabIssue,
        linkedForgejoIssue,
        autoApprove,
        useWorktree,
        baseRef,
        nameGenerated,
        useRemoteWorkspace,
        workspaceProvider
      ) => {
        await handleCreateTask(
          name,
          initialPrompt,
          agentRuns,
          linkedLinearIssue ?? null,
          linkedGithubIssue ?? null,
          linkedJiraIssue ?? null,
          linkedPlainThread ?? null,
          linkedGitlabIssue ?? null,
          linkedForgejoIssue ?? null,
          autoApprove,
          useWorktree,
          baseRef,
          nameGenerated,
          useRemoteWorkspace,
          workspaceProvider,
          initialProject ?? undefined
        );
      }}
    />
  );
}

const TaskModal: React.FC<TaskModalProps> = ({ onClose, initialProject, onCreateTask }) => {
  const {
    selectedProject,
    projectDefaultBranch: defaultBranch,
    projectBranchOptions: branchOptions,
    isLoadingBranches,
    refreshBranches,
  } = useProjectManagementContext();
  const { linkedGithubIssueMap, handleOpenExternalTask } = useTaskManagementContext();

  const workspaceProviderEnabled = useFeatureFlag('workspace-provider');
  const project = initialProject ?? selectedProject;
  const projectName = project?.name || '';
  const existingNames = (project?.tasks || []).map((w) => w.name);
  const projectPath = project?.path;
  // Form state
  const [taskName, setTaskName] = useState('');
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([{ agent: DEFAULT_AGENT, runs: 1 }]);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // PR mode state
  type TaskMode = 'branch' | 'pr';
  const [mode, setMode] = useState<TaskMode>('branch');
  const [prInput, setPrInput] = useState('');
  const [prDetails, setPrDetails] = useState<{
    baseRefName: string;
    headRefName: string;
    title: string;
    number: number;
    url: string;
  } | null>(null);
  const [prLoading, setPrLoading] = useState(false);
  const [prError, setPrError] = useState<string | null>(null);
  const { toast } = useToast();

  // Determine if PR mode is available (GitHub must be connected)
  const isGithubConnected = project?.githubInfo?.connected === true;

  // Advanced settings state
  const [initialPrompt, setInitialPrompt] = useState('');
  const [selectedLinearIssue, setSelectedLinearIssue] = useState<LinearIssueSummary | null>(null);
  const [selectedGithubIssue, setSelectedGithubIssue] = useState<GitHubIssueSummary | null>(null);
  const [selectedJiraIssue, setSelectedJiraIssue] = useState<JiraIssueSummary | null>(null);
  const [selectedGitlabIssue, setSelectedGitlabIssue] = useState<GitLabIssueSummary | null>(null);
  const [selectedPlainThread, setSelectedPlainThread] = useState<PlainThreadSummary | null>(null);
  const [selectedForgejoIssue, setSelectedForgejoIssue] = useState<ForgejoIssueSummary | null>(
    null
  );
  const [autoApprove, setAutoApprove] = useState(false);
  const [useWorktree, setUseWorktree] = useState(true);
  const [useRemoteWorkspace, setUseRemoteWorkspace] = useState(false);
  const [workspaceProviderConfig, setWorkspaceProviderConfig] = useState<{
    provisionCommand: string;
    terminateCommand: string;
  } | null>(null);

  // Load workspace provider config from .emdash.json (only when feature flag is on)
  useEffect(() => {
    if (!projectPath || !workspaceProviderEnabled) return;
    void (async () => {
      try {
        const result = await window.electronAPI.getProjectConfig(projectPath);
        if (result.success && result.content) {
          const parsed = JSON.parse(result.content);
          if (
            parsed?.workspaceProvider?.type === 'script' &&
            typeof parsed.workspaceProvider.provisionCommand === 'string' &&
            typeof parsed.workspaceProvider.terminateCommand === 'string'
          ) {
            setWorkspaceProviderConfig({
              provisionCommand: parsed.workspaceProvider.provisionCommand,
              terminateCommand: parsed.workspaceProvider.terminateCommand,
            });
          }
        }
      } catch {
        // Config not found or invalid — no workspace provider available
      }
    })();
  }, [projectPath, workspaceProviderEnabled]);

  // Fetch PR details on debounced valid input
  useEffect(() => {
    if (mode !== 'pr') return;

    const prNumber = parsePrInput(prInput);
    if (!prNumber) {
      setPrDetails(null);
      setPrError(null);
      return;
    }

    setPrError(null);

    const timer = setTimeout(async () => {
      setPrLoading(true);
      try {
        const result = await window.electronAPI.githubGetPullRequestDetails({
          projectPath: projectPath!,
          prNumber,
        });
        if (result.success && result.pr) {
          setPrDetails(result.pr);
          setPrError(null);
        } else {
          setPrDetails(null);
          setPrError(result.error || `PR #${prNumber} not found`);
        }
      } catch (err) {
        setPrDetails(null);
        setPrError(err instanceof Error ? err.message : 'Failed to fetch PR details');
      } finally {
        setPrLoading(false);
      }
    }, 500);

    return () => {
      clearTimeout(timer);
      setPrLoading(false);
    };
  }, [mode, prInput, projectPath]);

  // Branch selection state - sync with defaultBranch unless user manually changed it
  const [selectedBranch, setSelectedBranch] = useState(defaultBranch);
  const userChangedBranchRef = useRef(false);
  const taskNameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!userChangedBranchRef.current) {
      const branch = defaultBranch || pickDefaultBranch(branchOptions);
      if (branch) setSelectedBranch((prev) => (prev === branch ? prev : branch));
    }
  }, [defaultBranch, branchOptions]);

  const handleBranchChange = (value: string) => {
    setSelectedBranch(value);
    userChangedBranchRef.current = true;
  };

  // Auto-name tracking
  const [autoGeneratedName, setAutoGeneratedName] = useState('');
  const [autoGenerateName, setAutoGenerateName] = useState(true);
  const [autoInferTaskNames, setAutoInferTaskNames] = useState(false);
  const userHasTypedRef = useRef(false);
  const autoNameInitializedRef = useRef(false);
  const customNameTrackedRef = useRef(false);
  // True when the name was derived from context (prompt/issue) — already descriptive
  const nameFromContextRef = useRef(false);

  // Integration connections — always active since component only mounts when open
  const integrations = useIntegrationStatus(true);

  // Computed values
  const activeAgents = useMemo(() => agentRuns.map((ar) => ar.agent), [agentRuns]);
  const hasAutoApproveSupport = activeAgents.every((id) => !!agentMeta[id]?.autoApproveFlag);
  const hasInitialPromptSupport = activeAgents.every(
    (id) => agentMeta[id]?.initialPromptFlag !== undefined
  );

  const normalizedExisting = useMemo(
    () => existingNames.map((n) => normalizeTaskName(n)).filter(Boolean),
    [existingNames]
  );

  // Validation — empty name is allowed (will auto-generate a random fallback)
  const validate = useCallback(
    (value: string): string | null => {
      const normalized = normalizeTaskName(value);
      if (!normalized) return null; // Empty is OK — will generate a random name
      if (normalizedExisting.includes(normalized)) return 'A Task with this name already exists.';
      if (normalized.length > MAX_TASK_NAME_LENGTH)
        return `Task name is too long (max ${MAX_TASK_NAME_LENGTH} characters).`;
      return null;
    },
    [normalizedExisting]
  );

  // Clear issues when provider doesn't support them
  useEffect(() => {
    if (!hasInitialPromptSupport) {
      setSelectedLinearIssue(null);
      setSelectedGithubIssue(null);
      setSelectedJiraIssue(null);
      setSelectedGitlabIssue(null);
      setSelectedPlainThread(null);
      setSelectedForgejoIssue(null);
      setInitialPrompt('');
    }
  }, [hasInitialPromptSupport]);

  // Clear auto-approve if not supported
  useEffect(() => {
    if (!hasAutoApproveSupport && autoApprove) setAutoApprove(false);
  }, [hasAutoApproveSupport, autoApprove]);

  // Reset form and load settings on mount
  useEffect(() => {
    void refreshBranches();
    // Reset state
    setTaskName('');
    setAutoGeneratedName('');
    setError(null);
    setTouched(false);
    setIsFocused(false);
    setInitialPrompt('');
    setSelectedLinearIssue(null);
    setSelectedGithubIssue(null);
    setSelectedJiraIssue(null);
    setSelectedGitlabIssue(null);
    setSelectedPlainThread(null);
    setSelectedForgejoIssue(null);
    setAutoApprove(false);
    setUseWorktree(true);
    userHasTypedRef.current = false;
    autoNameInitializedRef.current = false;
    customNameTrackedRef.current = false;
    nameFromContextRef.current = false;
    userChangedBranchRef.current = false;
    setSelectedBranch(defaultBranch);

    // Generate initial name
    const suggested = generateFriendlyTaskName(normalizedExisting);
    setAutoGeneratedName(suggested);
    setTaskName(suggested);
    setError(validate(suggested));
    autoNameInitializedRef.current = true;

    // Load settings
    let cancel = false;
    rpc.appSettings.get().then((settings) => {
      if (cancel) return;

      const settingsAgent = settings?.defaultProvider;
      const agent: Agent = isValidProviderId(settingsAgent)
        ? (settingsAgent as Agent)
        : DEFAULT_AGENT;
      setAgentRuns([{ agent, runs: 1 }]);

      const autoApproveByDefault = settings?.tasks?.autoApproveByDefault ?? false;
      setAutoApprove(autoApproveByDefault && !!agentMeta[agent]?.autoApproveFlag);

      const createWorktreeByDefault = settings?.tasks?.createWorktreeByDefault ?? true;
      setUseWorktree(createWorktreeByDefault);

      // Handle auto-generate setting
      const shouldAutoGenerate = settings?.tasks?.autoGenerateName !== false;
      setAutoGenerateName(shouldAutoGenerate);
      if (!shouldAutoGenerate && !userHasTypedRef.current) {
        setAutoGeneratedName('');
        setTaskName('');
        setError(null);
      }

      // Handle auto-infer setting
      setAutoInferTaskNames(settings?.tasks?.autoInferTaskNames === true);
    });

    return () => {
      cancel = true;
    };
  }, []);

  // Auto-generate name from context (prompt / linked issue) with debounce.
  // Only active when both auto-generate and auto-infer settings are enabled.
  useEffect(() => {
    if (!autoGenerateName || !autoInferTaskNames || userHasTypedRef.current) return;

    // Immediate for issue linking, debounced for typed prompts
    const hasIssue = !!(
      selectedLinearIssue ||
      selectedGithubIssue ||
      selectedJiraIssue ||
      selectedPlainThread ||
      selectedGitlabIssue ||
      selectedForgejoIssue
    );
    const delay = hasIssue ? 0 : 400;

    const timer = setTimeout(() => {
      if (userHasTypedRef.current) return;
      const generated = generateTaskNameFromContext({
        initialPrompt: initialPrompt || null,
        linearIssue: selectedLinearIssue,
        githubIssue: selectedGithubIssue,
        jiraIssue: selectedJiraIssue,
        plainThread: selectedPlainThread,
        gitlabIssue: selectedGitlabIssue,
        forgejoIssue: selectedForgejoIssue,
      });
      if (generated) {
        nameFromContextRef.current = true;
        setAutoGeneratedName(generated);
        setTaskName(generated);
        setError(validate(generated));
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [
    autoGenerateName,
    autoInferTaskNames,
    initialPrompt,
    selectedLinearIssue,
    selectedGithubIssue,
    selectedJiraIssue,
    selectedPlainThread,
    selectedGitlabIssue,
    selectedForgejoIssue,
    validate,
  ]);

  const handleNameChange = (val: string) => {
    setTaskName(val);
    setError(validate(val));
    userHasTypedRef.current = true;

    // Track custom naming for telemetry (only once per session)
    if (
      autoGeneratedName &&
      val !== autoGeneratedName &&
      val.trim() &&
      !customNameTrackedRef.current
    ) {
      customNameTrackedRef.current = true;
      void (async () => {
        const { captureTelemetry } = await import('../lib/telemetryClient');
        captureTelemetry('task_custom_named', { custom_name: 'true' });
      })();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);

    const err = validate(taskName);
    if (err) {
      setError(err);
      return;
    }

    // Determine the final task name and whether it should be eligible for
    // post-creation auto-rename (nameGenerated flag).
    // Only mark for post-creation rename when autoInferTaskNames is enabled.
    let finalName = normalizeTaskName(taskName);
    let isNameGenerated = false;
    if (!finalName) {
      // No name at all — use a random fallback; mark for post-creation rename
      finalName = generateFriendlyTaskName(normalizedExisting);
      isNameGenerated = autoGenerateName && autoInferTaskNames;
    } else if (!userHasTypedRef.current && !nameFromContextRef.current) {
      // User never touched the name field AND the name wasn't derived from
      // context (prompt/issue) — it's still a random fallback name.
      // Mark for post-creation rename so the first terminal message can improve it.
      isNameGenerated = autoGenerateName && autoInferTaskNames;
    }
    // When the name was auto-generated from context (prompt/issue),
    // it's already descriptive — don't mark it for post-creation rename.

    setIsCreating(true);

    try {
      await onCreateTask(
        finalName,
        hasInitialPromptSupport && initialPrompt.trim() ? initialPrompt.trim() : undefined,
        agentRuns,
        selectedLinearIssue,
        selectedGithubIssue,
        selectedJiraIssue,
        selectedPlainThread,
        selectedGitlabIssue,
        selectedForgejoIssue,
        hasAutoApproveSupport ? autoApprove : false,
        useRemoteWorkspace ? false : useWorktree,
        selectedBranch,
        isNameGenerated,
        useRemoteWorkspace,
        useRemoteWorkspace && workspaceProviderConfig ? workspaceProviderConfig : undefined
      );
      onClose();
    } catch (error) {
      console.error('Failed to create task:', error);
      setIsCreating(false);
    }
  };

  const handlePrSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!prDetails || !project) return;

    setIsCreating(true);
    try {
      const result = await window.electronAPI.githubCreatePullRequestWorktree({
        projectPath: project.path,
        projectId: project.id,
        prNumber: prDetails.number,
        prTitle: prDetails.title,
      });

      if (result.success && result.task) {
        const task: Task = {
          id: result.task.id,
          projectId: result.task.projectId,
          name: result.task.name,
          branch: result.task.branch,
          path: result.task.path,
          status: result.task.status as Task['status'],
          agentId: result.task.agentId,
          useWorktree: true,
          metadata: result.task.metadata,
        };
        handleOpenExternalTask(task);
        onClose();
      } else if (result.success && result.worktree) {
        const task: Task = {
          id: result.worktree.id || crypto.randomUUID(),
          projectId: project.id,
          name: result.taskName || `PR #${prDetails.number}`,
          branch: result.branchName || '',
          path: result.worktree.path || '',
          status: 'active',
          useWorktree: true,
          metadata: { prNumber: prDetails.number, prTitle: prDetails.title },
        };
        handleOpenExternalTask(task);
        onClose();
      } else {
        toast({
          title: 'Failed to create review task',
          description: result.error || 'Unknown error',
          variant: 'destructive',
        });
      }
    } catch (err) {
      toast({
        title: 'Failed to create review task',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleOpenAutoFocus = useCallback(
    (event: Event) => {
      event.preventDefault();
      // In PR mode, the autoFocus on the PR input handles focus.
      // In branch mode, focus the task name input.
      if (mode !== 'pr') {
        taskNameInputRef.current?.focus({ preventScroll: true });
      }
    },
    [mode]
  );

  return (
    <DialogContent
      className="flex max-h-[calc(100vh-48px)] max-w-md flex-col overflow-hidden p-0"
      onOpenAutoFocus={handleOpenAutoFocus}
      onInteractOutside={(e) => {
        if (isCreating) e.preventDefault();
      }}
      onEscapeKeyDown={(e) => {
        if (isCreating) e.preventDefault();
      }}
    >
      <DialogHeader className="shrink-0 px-6 pr-12 pt-6">
        <DialogTitle>New Task</DialogTitle>
        <DialogDescription className="text-xs">
          Create a task and open the agent workspace.
        </DialogDescription>
        <div className="space-y-1 pt-1">
          <p className="text-sm font-medium text-foreground">{projectName}</p>

          {/* Mode toggle — only show "From PR" when GitHub is connected */}
          {isGithubConnected && (
            <div className="flex gap-1 rounded-md bg-muted p-0.5">
              <button
                type="button"
                className={`flex-1 rounded-sm px-3 py-1 text-xs font-medium transition-colors ${
                  mode === 'branch'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setMode('branch')}
              >
                New branch
              </button>
              <button
                type="button"
                className={`flex-1 rounded-sm px-3 py-1 text-xs font-medium transition-colors ${
                  mode === 'pr'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setMode('pr')}
              >
                From PR
              </button>
            </div>
          )}

          {mode === 'branch' && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">from</span>
              {branchOptions.length > 0 ? (
                <BranchSelect
                  value={selectedBranch}
                  onValueChange={handleBranchChange}
                  options={branchOptions}
                  isLoading={isLoadingBranches}
                  variant="ghost"
                />
              ) : (
                <span className="text-xs text-muted-foreground">
                  {isLoadingBranches ? 'Loading...' : selectedBranch || defaultBranch}
                </span>
              )}
            </div>
          )}
        </div>
      </DialogHeader>

      <form
        onSubmit={mode === 'pr' ? handlePrSubmit : handleSubmit}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {mode === 'pr' ? (
            /* -- PR mode input -- */
            <div>
              <Label htmlFor="pr-input" className="mb-2 block">
                Pull request number or URL
              </Label>
              <input
                id="pr-input"
                type="text"
                value={prInput}
                onChange={(e) => setPrInput(e.target.value)}
                placeholder="1603 or https://github.com/org/repo/pull/1603"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                autoFocus
              />
              {prLoading && (
                <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner size="sm" />
                  Looking up PR...
                </p>
              )}
              {prError && <p className="mt-2 text-xs text-destructive">{prError}</p>}
              {prDetails && !prLoading && (
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">PR #{prDetails.number}:</span>{' '}
                  {prDetails.title}
                </p>
              )}
            </div>
          ) : (
            /* -- Normal branch mode input -- */
            <div>
              <Label htmlFor="task-name" className="mb-2 block">
                Task name (optional)
              </Label>
              <SlugInput
                ref={taskNameInputRef}
                id="task-name"
                value={taskName}
                onChange={handleNameChange}
                onFocus={() => setIsFocused(true)}
                onBlur={() => {
                  setTouched(true);
                  setIsFocused(false);
                }}
                placeholder="refactor-api-routes"
                maxLength={MAX_TASK_NAME_LENGTH}
                className={`w-full ${touched && error && !isFocused ? 'border-destructive focus-visible:border-destructive focus-visible:ring-destructive' : ''}`}
                aria-invalid={touched && !!error && !isFocused}
              />
            </div>
          )}

          <div className="flex items-center gap-4">
            <Label className="shrink-0">Agent</Label>
            <MultiAgentDropdown agentRuns={agentRuns} onChange={setAgentRuns} />
          </div>

          {mode === 'branch' && (
            <TaskAdvancedSettings
              isOpen={true}
              projectPath={projectPath}
              useWorktree={useWorktree}
              onUseWorktreeChange={setUseWorktree}
              useRemoteWorkspace={useRemoteWorkspace}
              onUseRemoteWorkspaceChange={setUseRemoteWorkspace}
              hasWorkspaceProvider={!!workspaceProviderConfig}
              autoApprove={autoApprove}
              onAutoApproveChange={setAutoApprove}
              hasAutoApproveSupport={hasAutoApproveSupport}
              initialPrompt={initialPrompt}
              onInitialPromptChange={setInitialPrompt}
              hasInitialPromptSupport={hasInitialPromptSupport}
              selectedLinearIssue={selectedLinearIssue}
              onLinearIssueChange={setSelectedLinearIssue}
              isLinearConnected={integrations.isLinearConnected}
              onLinearConnect={integrations.handleLinearConnect}
              selectedGithubIssue={selectedGithubIssue}
              onGithubIssueChange={setSelectedGithubIssue}
              linkedGithubIssueMap={linkedGithubIssueMap}
              isGithubConnected={integrations.isGithubConnected}
              onGithubConnect={integrations.handleGithubConnect}
              githubLoading={integrations.githubLoading}
              githubInstalled={integrations.githubInstalled}
              selectedJiraIssue={selectedJiraIssue}
              onJiraIssueChange={setSelectedJiraIssue}
              isJiraConnected={integrations.isJiraConnected}
              onJiraConnect={integrations.handleJiraConnect}
              selectedGitlabIssue={selectedGitlabIssue}
              onGitlabIssueChange={setSelectedGitlabIssue}
              isGitlabConnected={integrations.isGitlabConnected}
              onGitlabConnect={integrations.handleGitlabConnect}
              selectedPlainThread={selectedPlainThread}
              onPlainThreadChange={setSelectedPlainThread}
              isPlainConnected={integrations.isPlainConnected}
              onPlainConnect={integrations.handlePlainConnect}
              selectedForgejoIssue={selectedForgejoIssue}
              onForgejoIssueChange={setSelectedForgejoIssue}
              isForgejoConnected={integrations.isForgejoConnected}
              onForgejoConnect={integrations.handleForgejoConnect}
            />
          )}
        </div>

        <DialogFooter className="shrink-0 px-6 py-4">
          <Button
            type="submit"
            disabled={mode === 'pr' ? !prDetails || prLoading || isCreating : !!error || isCreating}
            aria-busy={isCreating}
          >
            {isCreating ? (
              <>
                <Spinner size="sm" className="mr-2" />
                Creating...
              </>
            ) : (
              'Create'
            )}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
};

export default TaskModal;
