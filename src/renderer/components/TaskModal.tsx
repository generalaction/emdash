import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
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
import { type Project } from '../types/app';
import { agentMeta } from '../providers/meta';
import { isValidProviderId } from '@shared/providers/registry';
import { type LinearIssueSummary } from '../types/linear';
import { type GitHubIssueSummary } from '../types/github';
import { type JiraIssueSummary } from '../types/jira';
import { type GitLabIssueSummary } from '../types/gitlab';
import { type PlainThreadSummary } from '../types/plain';
import {
  generateFriendlyTaskName,
  normalizeTaskName,
  MAX_TASK_NAME_LENGTH,
} from '../lib/taskNames';
import BranchSelect from './BranchSelect';
import { generateTaskNameFromContext } from '../lib/branchNameGenerator';
import { useProjectManagementContext } from '../contexts/ProjectManagementProvider';
import { useTaskManagementContext } from '../contexts/TaskManagementContext';
import { rpc } from '@/lib/rpc';
import { cn } from '../lib/utils';

const DEFAULT_AGENT: Agent = 'claude';

export interface CreateTaskResult {
  name: string;
  initialPrompt?: string;
  agentRuns?: AgentRun[];
  linkedLinearIssue?: LinearIssueSummary | null;
  linkedGithubIssue?: GitHubIssueSummary | null;
  linkedJiraIssue?: JiraIssueSummary | null;
  linkedPlainThread?: PlainThreadSummary | null;
  autoApprove?: boolean;
  useWorktree?: boolean;
  baseRef?: string;
  nameGenerated?: boolean;
}

interface TaskModalProps {
  onClose: () => void;
  onCreateTask: (
    name: string,
    initialPrompt?: string,
    agentRuns?: AgentRun[],
    linkedLinearIssue?: LinearIssueSummary | null,
    linkedGithubIssue?: GitHubIssueSummary | null,
    linkedJiraIssue?: JiraIssueSummary | null,
    linkedPlainThread?: PlainThreadSummary | null,
    autoApprove?: boolean,
    useWorktree?: boolean,
    baseRef?: string,
    nameGenerated?: boolean,
    project?: Project | null
  ) => Promise<void>;
}

export type TaskModalOverlayProps = BaseModalProps<CreateTaskResult>;

export function TaskModalOverlay({ onClose }: TaskModalOverlayProps) {
  const { handleCreateTask } = useTaskManagementContext();

  return (
    <TaskModal
      onClose={onClose}
      onCreateTask={async (
        name,
        initialPrompt,
        agentRuns,
        linkedLinearIssue,
        linkedGithubIssue,
        linkedJiraIssue,
        linkedPlainThread,
        autoApprove,
        useWorktree,
        baseRef,
        nameGenerated,
        project
      ) => {
        await handleCreateTask(
          name,
          initialPrompt,
          agentRuns,
          linkedLinearIssue ?? null,
          linkedGithubIssue ?? null,
          linkedJiraIssue ?? null,
          linkedPlainThread ?? null,
          autoApprove,
          useWorktree,
          baseRef,
          nameGenerated,
          project
        );
      }}
    />
  );
}

const TaskModal: React.FC<TaskModalProps> = ({ onClose, onCreateTask }) => {
  const {
    projects,
    selectedProject,
    projectDefaultBranch: contextDefaultBranch,
    projectBranchOptions: contextBranchOptions,
    isLoadingBranches: contextIsLoadingBranches,
  } = useProjectManagementContext();
  const { linkedGithubIssueMap, tasksByProjectId } = useTaskManagementContext();

  // Local project selection - defaults to current project
  const [selectedModalProject, setSelectedModalProject] = useState<Project | null>(selectedProject);

  // Local branch state for when modal project differs from context project
  const [localBranchOptions, setLocalBranchOptions] = useState<{ value: string; label: string }[]>(
    []
  );
  const [localIsLoadingBranches, setLocalIsLoadingBranches] = useState(false);

  // Use context branch data when modal project matches selected project, otherwise use local state
  const isUsingContextProject = selectedModalProject?.id === selectedProject?.id;
  const branchOptions = isUsingContextProject ? contextBranchOptions : localBranchOptions;
  const isLoadingBranches = isUsingContextProject
    ? contextIsLoadingBranches
    : localIsLoadingBranches;
  const defaultBranch = selectedModalProject?.gitInfo?.baseRef || 'main';

  // Derived values use local selection
  const projectName = selectedModalProject?.name || '';
  const existingNames = useMemo(() => {
    if (!selectedModalProject) return [];
    const tasks = tasksByProjectId[selectedModalProject.id] || [];
    return tasks.map((t) => t.name);
  }, [selectedModalProject, tasksByProjectId]);
  const projectPath = selectedModalProject?.path;
  // Form state
  const [taskName, setTaskName] = useState('');
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([{ agent: DEFAULT_AGENT, runs: 1 }]);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // Advanced settings state
  const [initialPrompt, setInitialPrompt] = useState('');
  const [selectedLinearIssue, setSelectedLinearIssue] = useState<LinearIssueSummary | null>(null);
  const [selectedGithubIssue, setSelectedGithubIssue] = useState<GitHubIssueSummary | null>(null);
  const [selectedJiraIssue, setSelectedJiraIssue] = useState<JiraIssueSummary | null>(null);
  const [selectedGitlabIssue, setSelectedGitlabIssue] = useState<GitLabIssueSummary | null>(null);
  const [selectedPlainThread, setSelectedPlainThread] = useState<PlainThreadSummary | null>(null);
  const [autoApprove, setAutoApprove] = useState(false);
  const [useWorktree, setUseWorktree] = useState(true);

  // Branch selection state - sync with defaultBranch unless user manually changed it
  const [selectedBranch, setSelectedBranch] = useState(contextDefaultBranch);
  const userChangedBranchRef = useRef(false);
  const taskNameInputRef = useRef<HTMLInputElement>(null);
  // Track current modal project for race condition handling in branch loading
  const currentModalProjectIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userChangedBranchRef.current) {
      setSelectedBranch(isUsingContextProject ? contextDefaultBranch : defaultBranch);
    }
  }, [contextDefaultBranch, defaultBranch, isUsingContextProject]);

  const handleBranchChange = (value: string) => {
    setSelectedBranch(value);
    userChangedBranchRef.current = true;
  };

  // Auto-name tracking
  const [autoGeneratedName, setAutoGeneratedName] = useState('');
  const [autoGenerateName, setAutoGenerateName] = useState(true);
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
      setInitialPrompt('');
    }
  }, [hasInitialPromptSupport]);

  // Clear auto-approve if not supported
  useEffect(() => {
    if (!hasAutoApproveSupport && autoApprove) setAutoApprove(false);
  }, [hasAutoApproveSupport, autoApprove]);

  // Reset form and load settings on mount
  useEffect(() => {
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
    });

    return () => {
      cancel = true;
    };
  }, []);

  // Auto-generate name from context (prompt / linked issue) with debounce
  useEffect(() => {
    if (!autoGenerateName || userHasTypedRef.current) return;

    // Immediate for issue linking, debounced for typed prompts
    const hasIssue = !!(
      selectedLinearIssue ||
      selectedGithubIssue ||
      selectedJiraIssue ||
      selectedPlainThread
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
    initialPrompt,
    selectedLinearIssue,
    selectedGithubIssue,
    selectedJiraIssue,
    selectedPlainThread,
    validate,
  ]);

  // Refresh branches when modal project changes (only for non-context projects)
  useEffect(() => {
    if (!selectedModalProject) return;

    // Track current project for race condition handling
    currentModalProjectIdRef.current = selectedModalProject.id;

    // If we're on the context project, the context already handles branch loading
    if (selectedModalProject.id === selectedProject?.id) {
      userChangedBranchRef.current = false;
      setSelectedBranch(contextDefaultBranch);
      return;
    }

    // Load branches for the different project
    const loadBranches = async () => {
      const projectIdAtStart = selectedModalProject.id;
      setLocalIsLoadingBranches(true);
      const initialBranch = selectedModalProject.gitInfo?.baseRef || 'main';
      setLocalBranchOptions([{ value: initialBranch, label: initialBranch }]);

      try {
        let options: { value: string; label: string }[];

        if (selectedModalProject.isRemote && selectedModalProject.sshConnectionId) {
          const result = await window.electronAPI.sshExecuteCommand(
            selectedModalProject.sshConnectionId,
            'git branch -a --format="%(refname:short)"',
            selectedModalProject.path
          );
          if (result.exitCode === 0 && result.stdout) {
            const branches = result.stdout
              .split('\n')
              .map((b) => b.trim())
              .filter((b) => b.length > 0 && !b.includes('HEAD'));
            options = branches.map((b) => ({ value: b, label: b }));
          } else {
            options = [];
          }
        } else {
          const res = await window.electronAPI.listRemoteBranches({
            projectPath: selectedModalProject.path,
          });
          if (res.success && res.branches) {
            options = res.branches.map((b) => ({
              value: b.ref,
              label: b.remote ? b.label : `${b.branch} (local)`,
            }));
          } else {
            options = [];
          }
        }

        // Skip update if project changed during async operation
        if (currentModalProjectIdRef.current !== projectIdAtStart) return;

        if (options.length > 0) {
          setLocalBranchOptions(options);
        }
      } catch (error) {
        console.error('Failed to load branches:', error);
      } finally {
        // Only clear loading if still on same project
        if (currentModalProjectIdRef.current === projectIdAtStart) {
          setLocalIsLoadingBranches(false);
        }
      }
    };

    userChangedBranchRef.current = false;
    setSelectedBranch(selectedModalProject.gitInfo?.baseRef || 'main');
    void loadBranches();
  }, [selectedModalProject?.id, selectedProject?.id, contextDefaultBranch]);

  // Handle number key shortcuts for project selection
  useEffect(() => {
    if (projects.length <= 1) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Skip if typing in input/textarea
      const target = event.target as HTMLElement;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      ) {
        return;
      }

      // Check for number keys 1-9 without modifiers
      if (!/^[1-9]$/.test(event.key)) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;

      const index = parseInt(event.key, 10) - 1;
      if (index < projects.length) {
        event.preventDefault();
        setSelectedModalProject(projects[index]);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [projects]);

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
    let finalName = normalizeTaskName(taskName);
    let isNameGenerated = false;
    if (!finalName) {
      // No name at all — use a random fallback; mark for post-creation rename
      finalName = generateFriendlyTaskName(normalizedExisting);
      isNameGenerated = true;
    } else if (!userHasTypedRef.current && !nameFromContextRef.current) {
      // User never touched the name field AND the name wasn't derived from
      // context (prompt/issue) — it's still a random fallback name.
      // Mark for post-creation rename so the first terminal message can improve it.
      isNameGenerated = true;
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
        hasAutoApproveSupport ? autoApprove : false,
        useWorktree,
        selectedBranch,
        isNameGenerated,
        selectedModalProject
      );
      onClose();
    } catch (error) {
      console.error('Failed to create task:', error);
      setIsCreating(false);
    }
  };

  const handleOpenAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
    taskNameInputRef.current?.focus({ preventScroll: true });
  }, []);

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
        {projects.length > 1 ? (
          <div className="space-y-2 pt-1">
            <div className="max-h-28 overflow-y-auto rounded-md border border-input">
              {projects.map((project, index) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => setSelectedModalProject(project)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                    'transition-colors hover:bg-accent',
                    selectedModalProject?.id === project.id && 'bg-accent'
                  )}
                >
                  {index < 9 && (
                    <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {index + 1}
                    </kbd>
                  )}
                  <span className="flex-1 truncate">{project.name}</span>
                  {selectedModalProject?.id === project.id && (
                    <Check className="h-3 w-3 shrink-0 text-primary" />
                  )}
                </button>
              ))}
            </div>
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
          </div>
        ) : (
          <div className="space-y-1 pt-1">
            <p className="text-sm font-medium text-foreground">{projectName}</p>
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
          </div>
        )}
      </DialogHeader>

      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
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

          <div className="flex items-center gap-4">
            <Label className="shrink-0">Agent</Label>
            <MultiAgentDropdown agentRuns={agentRuns} onChange={setAgentRuns} />
          </div>

          <TaskAdvancedSettings
            isOpen={true}
            projectPath={projectPath}
            useWorktree={useWorktree}
            onUseWorktreeChange={setUseWorktree}
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
          />
        </div>

        <DialogFooter className="shrink-0 px-6 py-4">
          <Button type="submit" disabled={!!error || isCreating} aria-busy={isCreating}>
            {isCreating ? (
              <>
                <Spinner size="sm" className="mr-2" />
                Creating…
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
