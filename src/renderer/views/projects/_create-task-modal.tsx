import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isValidProviderId } from '@shared/agent-provider-registry';
import type { AppSettings } from '@shared/app-settings';
import type { BaseModalProps } from '@renderer/contexts/ModalProvider';
import { rpc } from '@renderer/lib/ipc';
import BranchSelect from '../../components/BranchSelect';
import { useIntegrationStatus } from '../../components/hooks/useIntegrationStatus';
import { MultiAgentDropdown } from '../../components/MultiAgentDropdown';
import { TaskAdvancedSettings } from '../../components/TaskAdvancedSettings';
import { Button } from '../../components/ui/button';
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Label } from '../../components/ui/label';
import { Separator } from '../../components/ui/separator';
import { SlugInput } from '../../components/ui/slug-input';
import { useProjectManagementContext } from '../../contexts/ProjectManagementProvider';
import { useTaskManagementContext } from '../../contexts/TaskManagementProvider';
import { useWorkspaceWrapParams } from '../../contexts/WorkspaceNavigationContext';
import { useProjectBranchOptions } from '../../hooks/useProjectBranchOptions';
import { generateTaskNameFromContext } from '../../lib/branchNameGenerator';
import {
  generateFriendlyTaskName,
  MAX_TASK_NAME_LENGTH,
  normalizeTaskName,
} from '../../lib/taskNames';
import { agentMeta } from '../../providers/meta';
import { type Agent } from '../../types';
import { type AgentRun } from '../../types/chat';
import { type GitHubIssueSummary } from '../../types/github';
import { type JiraIssueSummary } from '../../types/jira';
import { type LinearIssueSummary } from '../../types/linear';

const DEFAULT_AGENT: Agent = 'claude';

export interface CreateTaskResult {
  name: string;
  initialPrompt?: string;
  agentRuns?: AgentRun[];
  linkedLinearIssue?: LinearIssueSummary | null;
  linkedGithubIssue?: GitHubIssueSummary | null;
  linkedJiraIssue?: JiraIssueSummary | null;
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
    autoApprove?: boolean,
    useWorktree?: boolean,
    baseRef?: string,
    nameGenerated?: boolean
  ) => void;
}

export type TaskModalOverlayProps = BaseModalProps<CreateTaskResult>;

export function TaskModalOverlay({ onSuccess, onClose }: TaskModalOverlayProps) {
  return (
    <TaskModal
      onClose={onClose}
      onCreateTask={(
        name,
        initialPrompt,
        agentRuns,
        linkedLinearIssue,
        linkedGithubIssue,
        linkedJiraIssue,
        autoApprove,
        useWorktree,
        baseRef,
        nameGenerated
      ) =>
        onSuccess({
          name,
          initialPrompt,
          agentRuns,
          linkedLinearIssue,
          linkedGithubIssue,
          linkedJiraIssue,
          autoApprove,
          useWorktree,
          baseRef,
          nameGenerated,
        })
      }
    />
  );
}

const TaskModal: React.FC<TaskModalProps> = ({ onClose, onCreateTask }) => {
  const { projects } = useProjectManagementContext();
  const { wrapParams } = useWorkspaceWrapParams();
  const selectedProject = projects.find((p) => p.id === wrapParams.projectId) ?? null;
  const {
    projectDefaultBranch: defaultBranch,
    projectBranchOptions: branchOptions,
    isLoadingBranches,
  } = useProjectBranchOptions(selectedProject);
  const { linkedGithubIssueMap } = useTaskManagementContext();

  const projectName = selectedProject?.name || '';
  const existingNames = (selectedProject?.tasks || []).map((w) => w.name);
  const projectPath = selectedProject?.path;
  // Form state
  const [taskName, setTaskName] = useState('');
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([{ agent: DEFAULT_AGENT, runs: 1 }]);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  // Advanced settings state
  const [initialPrompt, setInitialPrompt] = useState('');
  const [selectedLinearIssue, setSelectedLinearIssue] = useState<LinearIssueSummary | null>(null);
  const [selectedGithubIssue, setSelectedGithubIssue] = useState<GitHubIssueSummary | null>(null);
  const [selectedJiraIssue, setSelectedJiraIssue] = useState<JiraIssueSummary | null>(null);
  const [autoApprove, setAutoApprove] = useState(false);
  const [useWorktree, setUseWorktree] = useState(true);

  // Branch selection state - sync with defaultBranch unless user manually changed it
  const [selectedBranch, setSelectedBranch] = useState(defaultBranch);
  const userChangedBranchRef = useRef(false);
  const taskNameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!userChangedBranchRef.current) {
      setSelectedBranch(defaultBranch);
    }
  }, [defaultBranch]);

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

  const integrations = useIntegrationStatus();

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
    Promise.all([
      rpc.appSettings.get('defaultAgent') as Promise<AppSettings['defaultAgent']>,
      rpc.appSettings.get('tasks') as Promise<AppSettings['tasks']>,
    ]).then(([defaultAgentSetting, taskSettings]) => {
      if (cancel) return;

      const agent: Agent = isValidProviderId(defaultAgentSetting)
        ? (defaultAgentSetting as Agent)
        : DEFAULT_AGENT;
      setAgentRuns([{ agent, runs: 1 }]);

      const autoApproveByDefault = taskSettings?.autoApproveByDefault ?? false;
      setAutoApprove(autoApproveByDefault && !!agentMeta[agent]?.autoApproveFlag);

      // Handle auto-generate setting
      const shouldAutoGenerate = taskSettings?.autoGenerateName !== false;
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
    const hasIssue = !!(selectedLinearIssue || selectedGithubIssue || selectedJiraIssue);
    const delay = hasIssue ? 0 : 400;

    const timer = setTimeout(() => {
      if (userHasTypedRef.current) return;
      const generated = generateTaskNameFromContext({
        initialPrompt: initialPrompt || null,
        linearIssue: selectedLinearIssue,
        githubIssue: selectedGithubIssue,
        jiraIssue: selectedJiraIssue,
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
        const { captureTelemetry } = await import('../../lib/telemetryClient');
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

    // Close modal immediately - task creation happens in background
    // The task will appear in sidebar via optimistic UI update
    onClose();

    // Fire and forget - don't await
    try {
      onCreateTask(
        finalName,
        hasInitialPromptSupport && initialPrompt.trim() ? initialPrompt.trim() : undefined,
        agentRuns,
        selectedLinearIssue,
        selectedGithubIssue,
        selectedJiraIssue,
        hasAutoApproveSupport ? autoApprove : false,
        useWorktree,
        selectedBranch,
        isNameGenerated
      );
    } catch (error) {
      console.error('Failed to create task:', error);
    }
  };

  useEffect(() => {
    taskNameInputRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <DialogContent className="max-h-[calc(100vh-48px)] max-w-md overflow-visible">
      <DialogHeader>
        <DialogTitle>New Task</DialogTitle>
        <DialogDescription className="text-xs">
          Create a task and open the agent workspace.
        </DialogDescription>
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
      </DialogHeader>

      <Separator />

      <form onSubmit={handleSubmit} className="space-y-4">
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
        />

        <DialogFooter>
          <Button type="submit" disabled={!!error}>
            Create
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
};

export default TaskModal;
