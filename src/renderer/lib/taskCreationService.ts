/**
 * Service for handling complex task creation logic
 * Extracts the massive handleCreateTask function from App.tsx
 */

import type { Provider } from '../types';
import type { Project, Task } from '../types/app';
import type { ProviderRun, TaskMetadata } from '../types/chat';
import type { GitHubIssueSummary } from '../types/github';
import type { JiraIssueSummary } from '../types/jira';
import type { LinearIssueSummary } from '../types/linear';

export interface CreateTaskParams {
  selectedProject: Project;
  taskName: string;
  initialPrompt?: string;
  providerRuns?: ProviderRun[];
  linkedLinearIssue?: LinearIssueSummary | null;
  linkedGithubIssue?: GitHubIssueSummary | null;
  linkedJiraIssue?: JiraIssueSummary | null;
  autoApprove?: boolean;
  useWorktree?: boolean;
  baseRef?: string;
}

export interface CreateTaskResult {
  task: Task;
  metadata: TaskMetadata | null;
}

/**
 * Enriches a Linear issue with description from API
 */
async function enrichLinearIssue(
  issue: LinearIssueSummary
): Promise<LinearIssueSummary> {
  try {
    const api: any = (window as any).electronAPI;
    let description: string | undefined;

    // Try bulk search first
    try {
      const res = await api?.linearGetIssues?.([issue.identifier]);
      const arr = res?.issues || res || [];
      const node = Array.isArray(arr)
        ? arr.find((n: any) => String(n?.identifier) === String(issue.identifier))
        : null;
      if (node?.description) description = String(node.description);
    } catch {}

    // Fallback to single issue endpoint
    if (!description) {
      const single = await api?.linearGetIssue?.(issue.identifier);
      if (single?.success && single.issue?.description) {
        description = String(single.issue.description);
      } else if (single?.description) {
        description = String(single.description);
      }
    }

    if (description) {
      return { ...issue, description } as any;
    }
  } catch {}

  return issue;
}

/**
 * Enriches a GitHub issue with body from API
 */
async function enrichGitHubIssue(
  issue: GitHubIssueSummary,
  projectPath: string
): Promise<GitHubIssueSummary> {
  try {
    const api: any = (window as any).electronAPI;
    const res = await api?.githubIssueGet?.(projectPath, issue.number);
    if (res?.success) {
      const body: string | undefined = res?.issue?.body || res?.body;
      if (body) return { ...issue, body } as any;
    }
  } catch {}

  return issue;
}

/**
 * Formats Linear issue details for prompt
 */
function formatLinearIssue(issue: LinearIssueSummary): string[] {
  const parts: string[] = [];
  const detailParts: string[] = [];

  const stateName = issue.state?.name?.trim();
  const assigneeName = issue.assignee?.displayName?.trim() || issue.assignee?.name?.trim();
  const teamKey = issue.team?.key?.trim();
  const projectName = issue.project?.name?.trim();

  if (stateName) detailParts.push(`State: ${stateName}`);
  if (assigneeName) detailParts.push(`Assignee: ${assigneeName}`);
  if (teamKey) detailParts.push(`Team: ${teamKey}`);
  if (projectName) detailParts.push(`Project: ${projectName}`);

  parts.push(`Linear: ${issue.identifier} — ${issue.title}`);
  if (detailParts.length) parts.push(`Details: ${detailParts.join(' • ')}`);
  if (issue.url) parts.push(`URL: ${issue.url}`);
  if ((issue as any).description) {
    parts.push('');
    parts.push('Issue Description:');
    parts.push(String((issue as any).description).trim());
  }

  return parts;
}

/**
 * Formats GitHub issue details for prompt
 */
function formatGitHubIssue(issue: GitHubIssueSummary): string[] {
  const parts: string[] = [];
  const detailParts: string[] = [];

  const stateName = issue.state?.toString()?.trim();
  const assignees = Array.isArray(issue.assignees)
    ? issue.assignees
        .map((a) => a?.name || a?.login)
        .filter(Boolean)
        .join(', ')
    : '';
  const labels = Array.isArray(issue.labels)
    ? issue.labels
        .map((l) => l?.name)
        .filter(Boolean)
        .join(', ')
    : '';

  if (stateName) detailParts.push(`State: ${stateName}`);
  if (assignees) detailParts.push(`Assignees: ${assignees}`);
  if (labels) detailParts.push(`Labels: ${labels}`);

  parts.push(`GitHub: #${issue.number} — ${issue.title}`);
  if (detailParts.length) parts.push(`Details: ${detailParts.join(' • ')}`);
  if (issue.url) parts.push(`URL: ${issue.url}`);
  if ((issue as any).body) {
    parts.push('');
    parts.push('Issue Description:');
    parts.push(String((issue as any).body).trim());
  }

  return parts;
}

/**
 * Prepares the initial prompt with linked issue details
 */
export async function prepareTaskPrompt(params: {
  initialPrompt?: string;
  linkedLinearIssue?: LinearIssueSummary | null;
  linkedGithubIssue?: GitHubIssueSummary | null;
  linkedJiraIssue?: JiraIssueSummary | null;
  projectPath?: string;
}): Promise<string | undefined> {
  const {
    initialPrompt,
    linkedLinearIssue,
    linkedGithubIssue,
    linkedJiraIssue,
    projectPath = ''
  } = params;

  if (!initialPrompt?.trim()) return undefined;

  const parts: string[] = [];

  // Add Linear issue details
  if (linkedLinearIssue) {
    const enriched = await enrichLinearIssue(linkedLinearIssue);
    parts.push(...formatLinearIssue(enriched));
    parts.push('');
  }

  // Add GitHub issue details
  if (linkedGithubIssue) {
    const enriched = await enrichGitHubIssue(linkedGithubIssue, projectPath);
    parts.push(...formatGitHubIssue(enriched));
    parts.push('');
  }

  // Add Jira issue details (placeholder - not implemented in original)
  if (linkedJiraIssue) {
    // Jira formatting would go here if needed
    parts.push('');
  }

  parts.push(initialPrompt.trim());
  return parts.join('\n');
}

/**
 * Creates a single-agent task
 */
async function createSingleAgentTask(params: {
  selectedProject: Project;
  taskName: string;
  primaryProvider: Provider;
  taskMetadata: TaskMetadata | null;
  useWorktree: boolean;
  autoApprove?: boolean;
  baseRef?: string;
}): Promise<Task> {
  const {
    selectedProject,
    taskName,
    primaryProvider,
    taskMetadata,
    useWorktree,
    autoApprove,
    baseRef
  } = params;

  let branch: string;
  let path: string;
  let taskId: string;

  if (useWorktree) {
    // Create worktree
    const worktreeResult = await window.electronAPI.worktreeCreate({
      projectPath: selectedProject.path,
      taskName,
      projectId: selectedProject.id,
      autoApprove,
      baseRef,
    });

    if (!worktreeResult.success) {
      throw new Error(worktreeResult.error || 'Failed to create worktree');
    }

    const worktree = worktreeResult.worktree;
    branch = worktree.branch;
    path = worktree.path;
    taskId = worktree.id;
  } else {
    // Direct branch mode - use current project path and branch
    branch = selectedProject.gitInfo.branch || 'main';
    path = selectedProject.path;
    taskId = `direct-${taskName}-${Date.now()}`;
  }

  const newTask: Task = {
    id: taskId,
    projectId: selectedProject.id,
    name: taskName,
    branch,
    path,
    status: 'idle',
    agentId: primaryProvider,
    metadata: taskMetadata,
    useWorktree,
  };

  const saveResult = await window.electronAPI.saveTask({
    ...newTask,
    agentId: primaryProvider,
    metadata: taskMetadata,
    useWorktree,
  });

  if (!saveResult?.success) {
    const { log } = await import('./logger');
    log.error('Failed to save task:', saveResult?.error);
    throw new Error('Failed to create task');
  }

  return newTask;
}

/**
 * Creates a multi-agent task with variants for each provider
 */
async function createMultiAgentTask(params: {
  selectedProject: Project;
  taskName: string;
  providerRuns: ProviderRun[];
  taskMetadata: TaskMetadata | null;
  useWorktree: boolean;
  autoApprove?: boolean;
  baseRef?: string;
}): Promise<Task> {
  const {
    selectedProject,
    taskName,
    providerRuns,
    taskMetadata,
    useWorktree,
    autoApprove,
    baseRef
  } = params;

  const variants: Array<{
    id: string;
    provider: Provider;
    name: string;
    branch: string;
    path: string;
    worktreeId: string;
  }> = [];

  // Create worktrees for each provider×runs combo
  for (const { provider, runs } of providerRuns) {
    for (let instanceIdx = 1; instanceIdx <= runs; instanceIdx++) {
      const instanceSuffix = runs > 1 ? `-${instanceIdx}` : '';
      const variantName = `${taskName}-${provider.toLowerCase()}${instanceSuffix}`;

      let branch: string;
      let path: string;
      let worktreeId: string;

      if (useWorktree) {
        const worktreeResult = await window.electronAPI.worktreeCreate({
          projectPath: selectedProject.path,
          taskName: variantName,
          projectId: selectedProject.id,
          autoApprove,
          baseRef,
        });

        if (!worktreeResult?.success || !worktreeResult.worktree) {
          throw new Error(
            worktreeResult?.error ||
              `Failed to create worktree for ${provider}${instanceSuffix}`
          );
        }

        const worktree = worktreeResult.worktree;
        branch = worktree.branch;
        path = worktree.path;
        worktreeId = worktree.id;
      } else {
        // Direct branch mode
        branch = selectedProject.gitInfo.branch || 'main';
        path = selectedProject.path;
        worktreeId = `direct-${taskName}-${provider.toLowerCase()}${instanceSuffix}`;
      }

      variants.push({
        id: `${taskName}-${provider.toLowerCase()}${instanceSuffix}`,
        provider,
        name: variantName,
        branch,
        path,
        worktreeId,
      });
    }
  }

  const primaryProvider = providerRuns[0]?.provider || 'codex';
  const multiMeta: TaskMetadata = {
    ...(taskMetadata || {}),
    multiAgent: {
      enabled: true,
      maxProviders: 4,
      providerRuns,
      variants,
      selectedProvider: null,
    },
  };

  const groupId = `ws-${taskName}-${Date.now()}`;
  const newTask: Task = {
    id: groupId,
    projectId: selectedProject.id,
    name: taskName,
    branch: variants[0]?.branch || selectedProject.gitInfo.branch || 'main',
    path: variants[0]?.path || selectedProject.path,
    status: 'idle',
    agentId: primaryProvider,
    metadata: multiMeta,
    useWorktree,
  };

  const saveResult = await window.electronAPI.saveTask({
    ...newTask,
    agentId: primaryProvider,
    metadata: multiMeta,
    useWorktree,
  });

  if (!saveResult?.success) {
    const { log } = await import('./logger');
    log.error('Failed to save multi-agent task:', saveResult?.error);
    throw new Error('Failed to create multi-agent task');
  }

  return newTask;
}

/**
 * Seeds a task conversation with linked issue context
 */
async function seedTaskWithIssueContext(task: Task, metadata: TaskMetadata): Promise<void> {
  const convoResult = await window.electronAPI.getOrCreateDefaultConversation(task.id);

  if (!convoResult?.success || !convoResult.conversation?.id) {
    return;
  }

  // Seed Linear issue context
  if (metadata.linearIssue) {
    const issue = metadata.linearIssue;
    const detailParts: string[] = [];
    const stateName = issue.state?.name?.trim();
    const assigneeName = issue.assignee?.displayName?.trim() || issue.assignee?.name?.trim();
    const teamKey = issue.team?.key?.trim();
    const projectName = issue.project?.name?.trim();

    if (stateName) detailParts.push(`State: ${stateName}`);
    if (assigneeName) detailParts.push(`Assignee: ${assigneeName}`);
    if (teamKey) detailParts.push(`Team: ${teamKey}`);
    if (projectName) detailParts.push(`Project: ${projectName}`);

    const lines = [`Linked Linear issue: ${issue.identifier} — ${issue.title}`];
    if (detailParts.length) {
      lines.push(`Details: ${detailParts.join(' • ')}`);
    }
    if (issue.url) {
      lines.push(`URL: ${issue.url}`);
    }
    if ((issue as any)?.description) {
      lines.push('');
      lines.push('Issue Description:');
      lines.push(String((issue as any).description).trim());
    }

    await window.electronAPI.saveMessage({
      id: `linear-context-${task.id}`,
      conversationId: convoResult.conversation.id,
      content: lines.join('\n'),
      sender: 'agent',
      metadata: JSON.stringify({
        isLinearContext: true,
        linearIssue: issue,
      }),
    });
  }

  // Seed GitHub issue context
  if (metadata.githubIssue) {
    const issue = metadata.githubIssue;
    const detailParts: string[] = [];
    const stateName = issue.state?.toString()?.trim();
    const assignees = Array.isArray(issue.assignees)
      ? issue.assignees
          .map((a) => a?.name || a?.login)
          .filter(Boolean)
          .join(', ')
      : '';
    const labels = Array.isArray(issue.labels)
      ? issue.labels
          .map((l) => l?.name)
          .filter(Boolean)
          .join(', ')
      : '';

    if (stateName) detailParts.push(`State: ${stateName}`);
    if (assignees) detailParts.push(`Assignees: ${assignees}`);
    if (labels) detailParts.push(`Labels: ${labels}`);

    const lines = [`Linked GitHub issue: #${issue.number} — ${issue.title}`];
    if (detailParts.length) {
      lines.push(`Details: ${detailParts.join(' • ')}`);
    }
    if (issue.url) {
      lines.push(`URL: ${issue.url}`);
    }
    if ((issue as any)?.body) {
      lines.push('');
      lines.push('Issue Description:');
      lines.push(String((issue as any).body).trim());
    }

    await window.electronAPI.saveMessage({
      id: `github-context-${task.id}`,
      conversationId: convoResult.conversation.id,
      content: lines.join('\n'),
      sender: 'agent',
      metadata: JSON.stringify({
        isGitHubContext: true,
        githubIssue: issue,
      }),
    });
  }

  // Seed Jira issue context
  if (metadata.jiraIssue) {
    const issue: any = metadata.jiraIssue;
    const lines: string[] = [];
    const line1 =
      `Linked Jira issue: ${issue.key || ''}${issue.summary ? ` — ${issue.summary}` : ''}`.trim();
    if (line1) lines.push(line1);

    const details: string[] = [];
    if (issue.status?.name) details.push(`Status: ${issue.status.name}`);
    if (issue.assignee?.displayName || issue.assignee?.name)
      details.push(`Assignee: ${issue.assignee?.displayName || issue.assignee?.name}`);
    if (issue.project?.key) details.push(`Project: ${issue.project.key}`);
    if (details.length) lines.push(`Details: ${details.join(' • ')}`);
    if (issue.url) lines.push(`URL: ${issue.url}`);

    await window.electronAPI.saveMessage({
      id: `jira-context-${task.id}`,
      conversationId: convoResult.conversation.id,
      content: lines.join('\n'),
      sender: 'agent',
      metadata: JSON.stringify({
        isJiraContext: true,
        jiraIssue: issue,
      }),
    });
  }
}

/**
 * Main task creation service function
 */
export async function createTask(params: CreateTaskParams): Promise<CreateTaskResult> {
  const {
    selectedProject,
    taskName,
    initialPrompt,
    providerRuns = [{ provider: 'claude', runs: 1 }],
    linkedLinearIssue = null,
    linkedGithubIssue = null,
    linkedJiraIssue = null,
    autoApprove = false,
    useWorktree = true,
    baseRef,
  } = params;

  // Prepare initial prompt with issue context
  const preparedPrompt = await prepareTaskPrompt({
    initialPrompt,
    linkedLinearIssue,
    linkedGithubIssue,
    linkedJiraIssue,
    projectPath: selectedProject.path,
  });

  // Build task metadata
  const taskMetadata: TaskMetadata | null =
    linkedLinearIssue || linkedJiraIssue || linkedGithubIssue || preparedPrompt || autoApprove
      ? {
          linearIssue: linkedLinearIssue ?? null,
          jiraIssue: linkedJiraIssue ?? null,
          githubIssue: linkedGithubIssue ?? null,
          initialPrompt: preparedPrompt ?? null,
          autoApprove: autoApprove ?? null,
        }
      : null;

  // Calculate total runs and determine if multi-agent
  const totalRuns = providerRuns.reduce((sum, pr) => sum + pr.runs, 0);
  const isMultiAgent = totalRuns > 1;
  const primaryProvider = providerRuns[0]?.provider || 'claude';

  let newTask: Task;

  if (isMultiAgent) {
    newTask = await createMultiAgentTask({
      selectedProject,
      taskName,
      providerRuns,
      taskMetadata,
      useWorktree,
      autoApprove,
      baseRef,
    });
  } else {
    newTask = await createSingleAgentTask({
      selectedProject,
      taskName,
      primaryProvider,
      taskMetadata,
      useWorktree,
      autoApprove,
      baseRef,
    });
  }

  // Seed task with issue context
  if (taskMetadata) {
    try {
      await seedTaskWithIssueContext(newTask, taskMetadata);
    } catch (seedError) {
      const { log } = await import('./logger');
      log.error('Failed to seed task with issue context:', seedError as any);
    }
  }

  // Track task creation
  const { captureTelemetry } = await import('./telemetryClient');
  captureTelemetry('task_created', {
    provider: isMultiAgent ? 'multi' : (newTask.agentId as string) || 'codex',
    has_initial_prompt: !!taskMetadata?.initialPrompt,
  });

  return {
    task: newTask,
    metadata: taskMetadata,
  };
}