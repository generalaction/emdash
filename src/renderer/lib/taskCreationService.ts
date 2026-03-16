import type { Agent } from '../types';
import type { Project, Task } from '../types/app';
import type { AgentRun, TaskMetadata } from '../types/chat';
import { type GitHubIssueSummary } from '../types/github';
import { type JiraIssueSummary } from '../types/jira';
import { type LinearIssueSummary } from '../types/linear';
import { type PlainThreadSummary } from '../types/plain';
import { type GitLabIssueSummary } from '../types/gitlab';
import { type ForgejoIssueSummary } from '../types/forgejo';
import { rpc } from './rpc';

export interface CreateTaskParams {
  project: Project;
  taskName: string;
  initialPrompt?: string;
  agentRuns: AgentRun[];
  linkedLinearIssue: LinearIssueSummary | null;
  linkedGithubIssue: GitHubIssueSummary | null;
  linkedJiraIssue: JiraIssueSummary | null;
  linkedPlainThread: PlainThreadSummary | null;
  linkedGitlabIssue: GitLabIssueSummary | null;
  linkedForgejoIssue: ForgejoIssueSummary | null;
  autoApprove?: boolean;
  nameGenerated?: boolean;
  useWorktree: boolean;
  baseRef?: string;
  preflightPromise?: Promise<unknown>;
}

export interface CreateTaskResult {
  task: Task;
  /** Non-fatal warning to surface in a toast (e.g. base-ref switch failure). */
  warning?: string;
}

async function runSetupOnCreate(
  taskId: string,
  taskPath: string,
  projectPath: string,
  taskName: string
): Promise<void> {
  try {
    const result = await window.electronAPI.lifecycleSetup({
      taskId,
      taskPath,
      projectPath,
      taskName,
    });
    if (!result?.success && !result?.skipped) {
      const { log } = await import('./logger');
      log.warn(`Setup script failed for task "${taskName}"`, result?.error);
    }
  } catch (error) {
    const { log } = await import('./logger');
    log.warn(`Setup script error for task "${taskName}"`, error as any);
  }
}

// ---------------------------------------------------------------------------
// Seed conversation with issue context after task creation (fire-and-forget).
// ---------------------------------------------------------------------------
function seedIssueContext(
  taskId: string,
  taskMetadata: TaskMetadata | null,
  provider?: string
): void {
  void (async () => {
    const hasIssueContext =
      taskMetadata?.linearIssue ||
      taskMetadata?.githubIssue ||
      taskMetadata?.jiraIssue ||
      taskMetadata?.plainThread ||
      taskMetadata?.gitlabIssue ||
      taskMetadata?.forgejoIssue;
    if (!hasIssueContext) return;

    let conversationId: string | undefined;
    try {
      const conversation = await rpc.db.getOrCreateDefaultConversation({ taskId, provider });
      if (conversation?.id) conversationId = conversation.id;
    } catch (error) {
      const { log } = await import('./logger');
      log.error('Failed to get or create default conversation:', error as any);
    }
    if (!conversationId) return;

    if (taskMetadata?.linearIssue) {
      try {
        const issue = taskMetadata.linearIssue;
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
        if (detailParts.length) lines.push(`Details: ${detailParts.join(' • ')}`);
        if (issue.url) lines.push(`URL: ${issue.url}`);
        if ((issue as any)?.description) {
          lines.push('');
          lines.push('Issue Description:');
          lines.push(String((issue as any).description).trim());
        }
        await rpc.db.saveMessage({
          id: `linear-context-${taskId}`,
          conversationId,
          content: lines.join('\n'),
          sender: 'agent',
          metadata: JSON.stringify({ isLinearContext: true, linearIssue: issue }),
        });
      } catch (seedError) {
        const { log } = await import('./logger');
        log.error('Failed to seed task with Linear issue context:', seedError as any);
      }
    }

    if (taskMetadata?.githubIssue) {
      try {
        const issue = taskMetadata.githubIssue;
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
        if (detailParts.length) lines.push(`Details: ${detailParts.join(' • ')}`);
        if (issue.url) lines.push(`URL: ${issue.url}`);
        if ((issue as any)?.body) {
          lines.push('');
          lines.push('Issue Description:');
          lines.push(String((issue as any).body).trim());
        }
        await rpc.db.saveMessage({
          id: `github-context-${taskId}`,
          conversationId,
          content: lines.join('\n'),
          sender: 'agent',
          metadata: JSON.stringify({ isGitHubContext: true, githubIssue: issue }),
        });
      } catch (seedError) {
        const { log } = await import('./logger');
        log.error('Failed to seed task with GitHub issue context:', seedError as any);
      }
    }

    if (taskMetadata?.jiraIssue) {
      try {
        const issue: any = taskMetadata.jiraIssue;
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
        await rpc.db.saveMessage({
          id: `jira-context-${taskId}`,
          conversationId,
          content: lines.join('\n'),
          sender: 'agent',
          metadata: JSON.stringify({ isJiraContext: true, jiraIssue: issue }),
        });
      } catch (seedError) {
        const { log } = await import('./logger');
        log.error('Failed to seed task with Jira issue context:', seedError as any);
      }
    }

    if (taskMetadata?.plainThread) {
      try {
        const thread = taskMetadata.plainThread;
        const detailParts: string[] = [];
        if (thread.status) detailParts.push(`Status: ${thread.status}`);
        const customerName = thread.customer?.fullName?.trim();
        const customerEmail = thread.customer?.email?.trim();
        if (customerName) detailParts.push(`Customer: ${customerName}`);
        if (customerEmail) detailParts.push(`Email: ${customerEmail}`);
        if (thread.priority) detailParts.push(`Priority: ${thread.priority}`);
        const labelNames = (thread.labels ?? [])
          .map((l) => l.name)
          .filter(Boolean)
          .join(', ');
        if (labelNames) detailParts.push(`Labels: ${labelNames}`);
        const lines = [
          `Linked Plain thread: ${thread.ref ? `${thread.ref} — ` : ''}${thread.title}`,
        ];
        if (detailParts.length) lines.push(`Details: ${detailParts.join(' • ')}`);
        if (thread.url) lines.push(`URL: ${thread.url}`);
        if (thread.description) {
          lines.push('');
          lines.push('Thread Description:');
          lines.push(String(thread.description).trim());
        }
        await rpc.db.saveMessage({
          id: `plain-context-${taskId}`,
          conversationId,
          content: lines.join('\n'),
          sender: 'agent',
          metadata: JSON.stringify({ isPlainContext: true, plainThread: thread }),
        });
      } catch (seedError) {
        const { log } = await import('./logger');
        log.error('Failed to seed task with Plain thread context:', seedError as any);
      }
    }

    if (taskMetadata?.gitlabIssue) {
      try {
        const issue = taskMetadata.gitlabIssue;
        const detailParts: string[] = [];
        if (issue.state) detailParts.push(`State: ${issue.state}`);
        if (issue.assignee?.name || issue.assignee?.username)
          detailParts.push(`Assignee: ${issue.assignee.name || issue.assignee.username}`);
        if (Array.isArray(issue.labels) && issue.labels.length)
          detailParts.push(`Labels: ${issue.labels.join(', ')}`);
        const lines = [`Linked GitLab issue: #${issue.iid} — ${issue.title}`];
        if (detailParts.length) lines.push(`Details: ${detailParts.join(' • ')}`);
        if (issue.web_url) lines.push(`URL: ${issue.web_url}`);
        if (issue.description) {
          lines.push('');
          lines.push('Issue Description:');
          lines.push(String(issue.description).trim());
        }
        await rpc.db.saveMessage({
          id: `gitlab-context-${taskId}`,
          conversationId,
          content: lines.join('\n'),
          sender: 'agent',
          metadata: JSON.stringify({ isGitLabContext: true, gitlabIssue: issue }),
        });
      } catch (seedError) {
        const { log } = await import('./logger');
        log.error('Failed to seed task with GitLab issue context:', seedError as any);
      }
    }

    if (taskMetadata?.forgejoIssue) {
      try {
        const issue = taskMetadata.forgejoIssue;
        const detailParts: string[] = [];
        if (issue.state) detailParts.push(`State: ${issue.state}`);
        if (issue.assignee?.name) detailParts.push(`Assignee: ${issue.assignee.name}`);
        if (Array.isArray(issue.labels) && issue.labels.length)
          detailParts.push(`Labels: ${issue.labels.join(', ')}`);
        const lines = [`Linked Forgejo issue: #${issue.number} — ${issue.title}`];
        if (detailParts.length) lines.push(`Details: ${detailParts.join(' • ')}`);
        if (issue.html_url) lines.push(`URL: ${issue.html_url}`);
        if (issue.description) {
          lines.push('');
          lines.push('Issue Description:');
          lines.push(String(issue.description).trim());
        }
        await rpc.db.saveMessage({
          id: `forgejo-context-${taskId}`,
          conversationId,
          content: lines.join('\n'),
          sender: 'agent',
          metadata: JSON.stringify({ isForgejoContext: true, forgejoIssue: issue }),
        });
      } catch (seedError) {
        const { log } = await import('./logger');
        log.error('Failed to seed task with Forgejo issue context:', seedError as any);
      }
    }
  })();
}

// ---------------------------------------------------------------------------
// Core task creation — pure backend function, no cache/UI knowledge.
// Throws on unrecoverable errors; returns a warning string for soft failures.
// ---------------------------------------------------------------------------
export async function createTask(params: CreateTaskParams): Promise<CreateTaskResult> {
  const {
    project,
    taskName,
    initialPrompt,
    agentRuns,
    linkedLinearIssue,
    linkedGithubIssue,
    linkedJiraIssue,
    linkedPlainThread,
    linkedGitlabIssue,
    linkedForgejoIssue,
    autoApprove,
    nameGenerated,
    useWorktree,
    baseRef,
    preflightPromise,
  } = params;

  // Build prompt prefix from linked issues
  let preparedPrompt: string | undefined;
  if (initialPrompt && initialPrompt.trim()) {
    const parts: string[] = [];
    if (linkedLinearIssue) {
      parts.push(`Linear: ${linkedLinearIssue.identifier} — ${linkedLinearIssue.title}`);
      if (linkedLinearIssue.url) parts.push(`URL: ${linkedLinearIssue.url}`);
      parts.push('');
    }
    if (linkedGithubIssue) {
      parts.push(`GitHub: #${linkedGithubIssue.number} — ${linkedGithubIssue.title}`);
      if (linkedGithubIssue.url) parts.push(`URL: ${linkedGithubIssue.url}`);
      parts.push('');
    }
    if (linkedPlainThread) {
      const t = linkedPlainThread;
      parts.push(`Plain thread: ${t.ref ? `${t.ref} — ` : ''}${t.title}`);
      const details: string[] = [];
      if (t.status) details.push(`Status: ${t.status}`);
      if (t.customer?.fullName) details.push(`Customer: ${t.customer.fullName}`);
      if (t.customer?.email) details.push(`Email: ${t.customer.email}`);
      if (t.priority != null) details.push(`Priority: ${t.priority}`);
      const labelNames = (t.labels ?? [])
        .map((l) => l.name)
        .filter(Boolean)
        .join(', ');
      if (labelNames) details.push(`Labels: ${labelNames}`);
      if (details.length) parts.push(details.join(' • '));
      if (t.url) parts.push(`URL: ${t.url}`);
      if (t.description) {
        parts.push('');
        parts.push(`Description: ${String(t.description).trim()}`);
      }
      parts.push('');
    }
    if (linkedGitlabIssue) {
      parts.push(`GitLab: #${linkedGitlabIssue.iid} — ${linkedGitlabIssue.title}`);
      if (linkedGitlabIssue.web_url) parts.push(`URL: ${linkedGitlabIssue.web_url}`);
      parts.push('');
    }
    if (linkedForgejoIssue) {
      parts.push(`Forgejo: #${linkedForgejoIssue.number} — ${linkedForgejoIssue.title}`);
      if (linkedForgejoIssue.html_url) parts.push(`URL: ${linkedForgejoIssue.html_url}`);
      parts.push('');
    }
    if (initialPrompt && initialPrompt.trim()) {
      parts.push(initialPrompt.trim());
    }
    preparedPrompt = parts.join('\n');
  }

  const taskMetadata: TaskMetadata | null =
    linkedLinearIssue ||
    linkedJiraIssue ||
    linkedGithubIssue ||
    linkedPlainThread ||
    linkedGitlabIssue ||
    linkedForgejoIssue ||
    preparedPrompt ||
    autoApprove ||
    nameGenerated
      ? {
          linearIssue: linkedLinearIssue ?? null,
          jiraIssue: linkedJiraIssue ?? null,
          githubIssue: linkedGithubIssue ?? null,
          plainThread: linkedPlainThread ?? null,
          gitlabIssue: linkedGitlabIssue ?? null,
          forgejoIssue: linkedForgejoIssue ?? null,
          initialPrompt: preparedPrompt ?? null,
          autoApprove: autoApprove ?? null,
          nameGenerated: nameGenerated ?? null,
        }
      : null;

  const totalRuns = agentRuns.reduce((sum, ar) => sum + ar.runs, 0);
  const isMultiAgent = totalRuns > 1;
  const primaryAgent = agentRuns[0]?.agent || 'claude';

  // ---------------------------------------------------------------------------
  // Multi-agent path
  // ---------------------------------------------------------------------------
  if (isMultiAgent) {
    const groupId = `ws-${taskName}-${Date.now()}`;

    // Build variant descriptors: worktree variants start as placeholders
    // so we can return the task immediately without blocking.
    const variants: Array<{
      id: string;
      agent: Agent;
      name: string;
      branch: string;
      path: string;
      worktreeId: string;
    }> = [];
    const pendingWorktreeVariants: Array<{
      index: number;
      variantName: string;
    }> = [];

    for (const { agent, runs } of agentRuns) {
      for (let instanceIdx = 1; instanceIdx <= runs; instanceIdx++) {
        const instanceSuffix = runs > 1 ? `-${instanceIdx}` : '';
        const variantName = `${taskName}-${agent.toLowerCase()}${instanceSuffix}`;

        if (useWorktree) {
          const idx = variants.length;
          variants.push({
            id: `${taskName}-${agent.toLowerCase()}${instanceSuffix}`,
            agent,
            name: variantName,
            branch: project.gitInfo.branch || 'main',
            path: project.path,
            worktreeId: `pending-${variantName}-${Date.now()}`,
          });
          pendingWorktreeVariants.push({ index: idx, variantName });
        } else {
          variants.push({
            id: `${taskName}-${agent.toLowerCase()}${instanceSuffix}`,
            agent,
            name: variantName,
            branch: project.gitInfo.branch || 'main',
            path: project.path,
            worktreeId: `direct-${taskName}-${agent.toLowerCase()}${instanceSuffix}`,
          });
        }
      }
    }

    const hasWorktreeVariants = pendingWorktreeVariants.length > 0;

    // Wait for the preflight freshness check if we need worktrees
    if (hasWorktreeVariants && preflightPromise) {
      await Promise.race([
        preflightPromise,
        new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
      ]);
    }

    const finalMeta: TaskMetadata = {
      ...(taskMetadata || {}),
      multiAgent: {
        enabled: true,
        maxAgents: 4,
        agentRuns,
        variants,
        selectedAgent: null,
      },
    };

    const finalTask: Task = {
      id: groupId,
      projectId: project.id,
      name: taskName,
      branch: variants[0]?.branch || project.gitInfo.branch || 'main',
      path: variants[0]?.path || project.path,
      status: hasWorktreeVariants ? 'creating' : 'idle',
      agentId: primaryAgent,
      metadata: finalMeta,
      useWorktree,
    };

    try {
      await rpc.db.saveTask({
        ...finalTask,
        agentId: primaryAgent,
        metadata: finalMeta,
        useWorktree,
      });
    } catch (saveErr) {
      const { log } = await import('./logger');
      log.error('Failed to save multi-agent task:', saveErr);
      throw saveErr;
    }

    // Fire-and-forget: launch all variant worktree creations in parallel.
    // As each completes, update the group task metadata in the DB.
    // The onWorktreeCreationEvent listener in useTaskManagement handles
    // the frontend cache transitions.
    if (hasWorktreeVariants) {
      void (async () => {
        const results = await Promise.allSettled(
          pendingWorktreeVariants.map(async ({ index, variantName }) => {
            const startResult = await window.electronAPI.worktreeStartTaskCreation({
              projectId: project.id,
              projectPath: project.path,
              taskName: variantName,
              baseRef,
              task: {
                projectId: project.id,
                name: variantName,
                status: 'creating',
                agentId: primaryAgent,
                metadata: null,
                useWorktree: true,
              },
            });
            if (!startResult.success || !startResult.task) {
              throw new Error(
                startResult.error || `Failed to start worktree creation for ${variantName}`
              );
            }
            return { index, task: startResult.task, completed: startResult.completed };
          })
        );

        // Update group task metadata with resolved variant info
        const allTasks = await rpc.db.getTasks(project.id);
        const latestTask = allTasks.find((t) => t.id === groupId);
        if (!latestTask) return;

        const updatedVariants = [...variants];
        let anyFailed = false;
        const failedNames: string[] = [];

        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          const { index, variantName } = pendingWorktreeVariants[i];
          if (result.status === 'fulfilled') {
            const { task: variantTask } = result.value;
            updatedVariants[index] = {
              ...updatedVariants[index],
              branch: variantTask.branch,
              path: variantTask.path,
              worktreeId: variantTask.id,
            };
          } else {
            anyFailed = true;
            failedNames.push(variantName);
            const { log } = await import('./logger');
            log.error(`Multi-agent variant worktree failed: ${variantName}`, result.reason);
          }
        }

        const updatedMeta: TaskMetadata = {
          ...((latestTask.metadata as TaskMetadata) || {}),
          multiAgent: {
            ...((latestTask.metadata as TaskMetadata)?.multiAgent || {
              enabled: true,
              maxAgents: 4,
              agentRuns,
              selectedAgent: null,
            }),
            variants: updatedVariants,
          },
        };

        const allCompleted = results.every((r) => r.status === 'fulfilled' && r.value.completed);

        await rpc.db.saveTask({
          ...latestTask,
          branch: updatedVariants[0]?.branch || latestTask.branch,
          path: updatedVariants[0]?.path || latestTask.path,
          status: anyFailed ? 'error' : allCompleted ? 'idle' : 'creating',
          metadata: updatedMeta,
        });

        // Run setup for completed variants
        for (const result of results) {
          if (result.status === 'fulfilled' && result.value.completed) {
            const variant = updatedVariants[result.value.index];
            void runSetupOnCreate(variant.worktreeId, variant.path, project.path, variant.name);
          }
        }

        if (anyFailed) {
          // Clean up worktrees for successfully created variants when some failed
          for (const result of results) {
            if (result.status === 'fulfilled') {
              const variant = updatedVariants[result.value.index];
              if (
                variant.worktreeId &&
                !variant.worktreeId.startsWith('direct-') &&
                !variant.worktreeId.startsWith('pending-')
              ) {
                window.electronAPI
                  .worktreeRemove({ projectPath: project.path, worktreeId: variant.worktreeId })
                  .catch(() => {});
              }
            }
          }
        }
      })();
    } else {
      // No worktree variants — run setup immediately
      for (const variant of variants) {
        void runSetupOnCreate(variant.worktreeId, variant.path, project.path, variant.name);
      }
    }

    void import('./telemetryClient').then(({ captureTelemetry }) => {
      captureTelemetry('task_created', {
        provider: 'multi',
        has_initial_prompt: !!taskMetadata?.initialPrompt,
      });
      if (linkedGithubIssue) captureTelemetry('task_created_with_issue', { source: 'github' });
      if (linkedLinearIssue) captureTelemetry('task_created_with_issue', { source: 'linear' });
      if (linkedJiraIssue) captureTelemetry('task_created_with_issue', { source: 'jira' });
      if (linkedPlainThread) captureTelemetry('task_created_with_issue', { source: 'plain' });
      if (linkedGitlabIssue) captureTelemetry('task_created_with_issue', { source: 'gitlab' });
      if (linkedForgejoIssue) captureTelemetry('task_created_with_issue', { source: 'forgejo' });
    });
    seedIssueContext(finalTask.id, taskMetadata, finalTask.agentId || primaryAgent);

    return { task: finalTask };
  }

  // ---------------------------------------------------------------------------
  // Single-agent path
  // ---------------------------------------------------------------------------
  let branch: string;
  let path: string;
  let taskId: string;
  let persistedByMain = false;
  let taskStatus: Task['status'] = 'idle';
  let warning: string | undefined;

  if (useWorktree) {
    // Wait for the preflight freshness check (started when the modal opened)
    // so the reserve is up-to-date before we claim it.  Timeout after 10s
    // to avoid blocking task creation if ls-remote hangs.
    if (preflightPromise) {
      await Promise.race([
        preflightPromise,
        new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
      ]);
    }

    const startResult = await window.electronAPI.worktreeStartTaskCreation({
      projectId: project.id,
      projectPath: project.path,
      taskName,
      baseRef,
      task: {
        projectId: project.id,
        name: taskName,
        status: 'creating',
        agentId: primaryAgent,
        metadata: taskMetadata,
        useWorktree,
      },
    });

    if (startResult.success && startResult.task) {
      branch = startResult.task.branch;
      path = startResult.task.path;
      taskId = startResult.task.id;
      taskStatus = startResult.task.status ?? (startResult.completed ? 'idle' : 'creating');
      persistedByMain = true;
      if (startResult.needsBaseRefSwitch) {
        warning = `Could not switch to ${baseRef}. Task created on default branch.`;
      }
    } else {
      throw new Error(startResult.error || 'Failed to start worktree creation');
    }
  } else {
    branch = project.gitInfo.branch || 'main';
    path = project.path;
    taskId = `direct-${taskName}-${Date.now()}`;
    taskStatus = 'idle';
  }

  const newTask: Task = {
    id: taskId,
    projectId: project.id,
    name: taskName,
    branch,
    path,
    status: taskStatus,
    agentId: primaryAgent,
    metadata: taskMetadata,
    useWorktree,
  };

  if (!persistedByMain) {
    try {
      await rpc.db.saveTask({
        ...newTask,
        agentId: primaryAgent,
        metadata: taskMetadata,
        useWorktree,
      });
    } catch (saveErr) {
      const { log } = await import('./logger');
      log.error('Failed to save task:', saveErr);
      // Non-fatal: task is created in memory and will work this session
      warning = 'Task created but may not persist after restart. Try again if it disappears.';
    }
  }

  // Background: setup, telemetry, issue seeding
  if (newTask.status !== 'creating') {
    void runSetupOnCreate(newTask.id, newTask.path, project.path, newTask.name);
  }
  void import('./telemetryClient').then(({ captureTelemetry }) => {
    captureTelemetry('task_created', {
      provider: (newTask.agentId as string) || 'codex',
      has_initial_prompt: !!taskMetadata?.initialPrompt,
    });
    if (linkedGithubIssue) captureTelemetry('task_created_with_issue', { source: 'github' });
    if (linkedLinearIssue) captureTelemetry('task_created_with_issue', { source: 'linear' });
    if (linkedJiraIssue) captureTelemetry('task_created_with_issue', { source: 'jira' });
    if (linkedPlainThread) captureTelemetry('task_created_with_issue', { source: 'plain' });
    if (linkedGitlabIssue) captureTelemetry('task_created_with_issue', { source: 'gitlab' });
    if (linkedForgejoIssue) captureTelemetry('task_created_with_issue', { source: 'forgejo' });
  });
  seedIssueContext(newTask.id, taskMetadata, newTask.agentId || primaryAgent);

  return { task: newTask, warning };
}
