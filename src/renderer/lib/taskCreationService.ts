import { type Agent } from '../types';
import type { Project, Task } from '../types/app';
import type { AgentRun, TaskMetadata } from '../types/chat';
import { type GitHubIssueSummary } from '../types/github';
import { type JiraIssueSummary } from '../types/jira';
import { type LinearIssueSummary } from '../types/linear';
import { saveActiveIds } from '../constants/layout';
import { getAgentForTask } from './getAgentForTask';

export interface CreateTaskParams {
  taskName: string;
  initialPrompt?: string;
  agentRuns: AgentRun[];
  linkedLinearIssue: LinearIssueSummary | null;
  linkedGithubIssue: GitHubIssueSummary | null;
  linkedJiraIssue: JiraIssueSummary | null;
  autoApprove?: boolean;
  useWorktree: boolean;
  baseRef?: string;
}

export interface CreateTaskCallbacks {
  selectedProject: Project;
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  setSelectedProject: React.Dispatch<React.SetStateAction<Project | null>>;
  setActiveTask: React.Dispatch<React.SetStateAction<Task | null>>;
  setActiveTaskAgent: React.Dispatch<React.SetStateAction<Agent | null>>;
  toast: (opts: any) => void;
  onTaskCreationFailed?: () => void;
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

export async function createTask(
  params: CreateTaskParams,
  callbacks: CreateTaskCallbacks
): Promise<boolean> {
  const {
    taskName,
    initialPrompt,
    agentRuns,
    linkedLinearIssue,
    linkedGithubIssue,
    linkedJiraIssue,
    autoApprove,
    useWorktree,
    baseRef,
  } = params;
  const {
    selectedProject,
    setProjects,
    setSelectedProject,
    setActiveTask,
    setActiveTaskAgent,
    toast,
  } = callbacks;

  try {
    // Build basic prompt without enrichment (enrichment happens in background later)
    // This makes task creation instant - user sees the task immediately
    let preparedPrompt: string | undefined = undefined;
    if (initialPrompt && initialPrompt.trim()) {
      const parts: string[] = [];
      // Add basic issue info without API enrichment
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
      parts.push(initialPrompt.trim());
      preparedPrompt = parts.join('\n');
    }
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
    const totalRuns = agentRuns.reduce((sum, ar) => sum + ar.runs, 0);
    const isMultiAgent = totalRuns > 1;
    const primaryAgent = agentRuns[0]?.agent || 'claude';

    let newTask: Task;
    if (isMultiAgent) {
      // Multi-agent task: show UI immediately with loading state, create worktrees in background
      const groupId = `ws-${taskName}-${Date.now()}`;

      // Create optimistic task with empty variants so the parent can show a unified loading state
      const optimisticMeta: TaskMetadata = {
        ...(taskMetadata || {}),
        multiAgent: {
          enabled: true,
          maxAgents: 4,
          agentRuns,
          variants: [], // Empty initially - shows loading spinner
          selectedAgent: null,
        },
      };

      newTask = {
        id: groupId,
        projectId: selectedProject.id,
        name: taskName,
        branch: selectedProject.gitInfo.branch || 'main',
        path: selectedProject.path,
        status: 'idle',
        agentId: primaryAgent,
        metadata: optimisticMeta,
        useWorktree,
      };

      // Helper to remove optimistic task on failure
      const removeOptimisticTask = () => {
        setProjects((prev) =>
          prev.map((project) =>
            project.id === selectedProject.id
              ? { ...project, tasks: project.tasks?.filter((t) => t.id !== groupId) }
              : project
          )
        );
        setSelectedProject((prev) =>
          prev ? { ...prev, tasks: prev.tasks?.filter((t) => t.id !== groupId) } : null
        );
        setActiveTask((current) => (current?.id === groupId ? null : current));
        callbacks.onTaskCreationFailed?.();
      };

      // Update UI immediately while worktrees are created in the background
      setProjects((prev) =>
        prev.map((project) =>
          project.id === selectedProject.id
            ? { ...project, tasks: [newTask, ...(project.tasks || [])] }
            : project
        )
      );
      setSelectedProject((prev) =>
        prev ? { ...prev, tasks: [newTask, ...(prev.tasks || [])] } : null
      );
      setActiveTask(newTask);
      setActiveTaskAgent(null);
      saveActiveIds(newTask.projectId, newTask.id);

      // Create worktrees in background, then update task with real variants
      (async () => {
        const variants: Array<{
          id: string;
          agent: Agent;
          name: string;
          branch: string;
          path: string;
          worktreeId: string;
        }> = [];

        try {
          for (const { agent, runs } of agentRuns) {
            for (let instanceIdx = 1; instanceIdx <= runs; instanceIdx++) {
              const instanceSuffix = runs > 1 ? `-${instanceIdx}` : '';
              const variantName = `${taskName}-${agent.toLowerCase()}${instanceSuffix}`;

              let branch: string;
              let path: string;
              let worktreeId: string;

              if (useWorktree) {
                const worktreeResult = await window.electronAPI.worktreeCreate({
                  projectPath: selectedProject.path,
                  taskName: variantName,
                  projectId: selectedProject.id,
                  baseRef,
                });
                if (!worktreeResult?.success || !worktreeResult.worktree) {
                  throw new Error(
                    worktreeResult?.error ||
                      `Failed to create worktree for ${agent}${instanceSuffix}`
                  );
                }
                const worktree = worktreeResult.worktree;
                branch = worktree.branch;
                path = worktree.path;
                worktreeId = worktree.id;
              } else {
                // Direct branch mode - use current project path and branch
                branch = selectedProject.gitInfo.branch || 'main';
                path = selectedProject.path;
                worktreeId = `direct-${taskName}-${agent.toLowerCase()}${instanceSuffix}`;
              }

              variants.push({
                id: `${taskName}-${agent.toLowerCase()}${instanceSuffix}`,
                agent: agent,
                name: variantName,
                branch,
                path,
                worktreeId,
              });
            }
          }

          // Build final metadata with real variants
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
            ...newTask,
            branch: variants[0]?.branch || selectedProject.gitInfo.branch || 'main',
            path: variants[0]?.path || selectedProject.path,
            metadata: finalMeta,
          };

          // Save to DB
          const saveResult = await window.electronAPI.saveTask({
            ...finalTask,
            agentId: primaryAgent,
            metadata: finalMeta,
            useWorktree,
          });

          if (!saveResult?.success) {
            const { log } = await import('./logger');
            log.error('Failed to save multi-agent task:', saveResult?.error);
            // Clean up worktrees that were created before the save failed
            for (const variant of variants) {
              if (variant.worktreeId && !variant.worktreeId.startsWith('direct-')) {
                window.electronAPI
                  .worktreeRemove({
                    projectPath: selectedProject.path,
                    worktreeId: variant.worktreeId,
                  })
                  .catch(() => {});
              }
            }
            toast({
              title: 'Error',
              description: 'Failed to save multi-agent task.',
              variant: 'destructive',
            });
            removeOptimisticTask();
            return;
          }

          // Update UI with final task containing real variants
          setProjects((prev) =>
            prev.map((project) =>
              project.id === selectedProject.id
                ? {
                    ...project,
                    tasks: project.tasks?.map((t) => (t.id === groupId ? finalTask : t)),
                  }
                : project
            )
          );
          setSelectedProject((prev) =>
            prev
              ? { ...prev, tasks: prev.tasks?.map((t) => (t.id === groupId ? finalTask : t)) }
              : null
          );
          setActiveTask((current) => (current?.id === groupId ? finalTask : current));

          // Run setup once per created variant worktree.
          for (const variant of variants) {
            void runSetupOnCreate(
              variant.worktreeId,
              variant.path,
              selectedProject.path,
              variant.name
            );
          }
        } catch (error) {
          const { log } = await import('./logger');
          log.error('Failed to create multi-agent worktrees:', error as Error);
          // Clean up any worktrees that were created before the failure
          for (const variant of variants) {
            if (variant.worktreeId && !variant.worktreeId.startsWith('direct-')) {
              window.electronAPI
                .worktreeRemove({
                  projectPath: selectedProject.path,
                  worktreeId: variant.worktreeId,
                })
                .catch(() => {});
            }
          }
          toast({
            title: 'Error',
            description:
              error instanceof Error ? error.message : 'Failed to create multi-agent workspaces.',
            variant: 'destructive',
          });
          removeOptimisticTask();
        }
      })();

      // Telemetry
      import('./telemetryClient').then(({ captureTelemetry }) => {
        captureTelemetry('task_created', {
          provider: 'multi',
          has_initial_prompt: !!taskMetadata?.initialPrompt,
        });
        if (linkedGithubIssue) captureTelemetry('task_created_with_issue', { source: 'github' });
        if (linkedLinearIssue) captureTelemetry('task_created_with_issue', { source: 'linear' });
        if (linkedJiraIssue) captureTelemetry('task_created_with_issue', { source: 'jira' });
      });
      return true;
    } else {
      let branch: string;
      let path: string;
      let taskId: string;
      let taskPersistedInClaim = false;

      if (useWorktree) {
        // Try to claim a pre-created reserve worktree and persist task in one IPC call.
        const claimAndSaveResult = await window.electronAPI.worktreeClaimReserveAndSaveTask({
          projectId: selectedProject.id,
          projectPath: selectedProject.path,
          taskName,
          baseRef,
          task: {
            projectId: selectedProject.id,
            name: taskName,
            status: 'idle',
            agentId: primaryAgent,
            metadata: taskMetadata,
            useWorktree,
          },
        });

        if (claimAndSaveResult.success && claimAndSaveResult.worktree) {
          const worktree = claimAndSaveResult.worktree;
          branch = worktree.branch;
          path = worktree.path;
          taskId = worktree.id;
          taskPersistedInClaim = true;

          // Warn if base ref switch failed
          if (claimAndSaveResult.needsBaseRefSwitch) {
            toast({
              title: 'Warning',
              description: `Could not switch to ${baseRef}. Task created on default branch.`,
            });
          }
        } else {
          // Fallback (or forced): Create worktree
          const worktreeResult = await window.electronAPI.worktreeCreate({
            projectPath: selectedProject.path,
            taskName,
            projectId: selectedProject.id,
            baseRef,
          });

          if (!worktreeResult.success) {
            throw new Error(worktreeResult.error || 'Failed to create worktree');
          }

          const worktree = worktreeResult.worktree;
          branch = worktree.branch;
          path = worktree.path;
          taskId = worktree.id;
        }
      } else {
        // Direct branch mode - use current project path and branch
        branch = selectedProject.gitInfo.branch || 'main';
        path = selectedProject.path;
        taskId = `direct-${taskName}-${Date.now()}`;
      }

      newTask = {
        id: taskId,
        projectId: selectedProject.id,
        name: taskName,
        branch,
        path,
        status: 'idle',
        agentId: primaryAgent,
        metadata: taskMetadata,
        useWorktree,
      };

      // Save task to database before activating it in the UI.
      // Conversations and messages have FK constraints on the task row,
      // so the task must exist in DB before ChatInterface mounts and
      // tries to create/load conversations.
      if (!taskPersistedInClaim) {
        const saveResult = await window.electronAPI.saveTask({
          ...newTask,
          agentId: primaryAgent,
          metadata: taskMetadata,
          useWorktree,
        });
        if (!saveResult?.success) {
          const { log } = await import('./logger');
          log.error('Failed to save task:', saveResult?.error);
          toast({
            title: 'Warning',
            description:
              'Task created but may not persist after restart. Try again if it disappears.',
            variant: 'destructive',
          });
        }
      }

      // Update UI state now that DB row exists
      setProjects((prev) =>
        prev.map((project) =>
          project.id === selectedProject.id
            ? {
                ...project,
                tasks: [newTask, ...(project.tasks || [])],
              }
            : project
        )
      );

      setSelectedProject((prev) =>
        prev
          ? {
              ...prev,
              tasks: [newTask, ...(prev.tasks || [])],
            }
          : null
      );

      // Set the active task and its agent
      setActiveTask(newTask);
      setActiveTaskAgent(getAgentForTask(newTask) ?? primaryAgent ?? 'codex');
      saveActiveIds(newTask.projectId, newTask.id);

      // Run setup after task creation (non-blocking).
      void runSetupOnCreate(newTask.id, newTask.path, selectedProject.path, newTask.name);

      // Background: telemetry (non-blocking)
      import('./telemetryClient').then(({ captureTelemetry }) => {
        const isMultiAgentTask = (newTask.metadata as any)?.multiAgent?.enabled;
        captureTelemetry('task_created', {
          provider: isMultiAgentTask ? 'multi' : (newTask.agentId as string) || 'codex',
          has_initial_prompt: !!taskMetadata?.initialPrompt,
        });
        if (linkedGithubIssue) captureTelemetry('task_created_with_issue', { source: 'github' });
        if (linkedLinearIssue) captureTelemetry('task_created_with_issue', { source: 'linear' });
        if (linkedJiraIssue) captureTelemetry('task_created_with_issue', { source: 'jira' });
      });

      // Background: seed conversation with issue context (non-blocking)
      // This runs after modal closes so user sees task immediately
      (async () => {
        const hasIssueContext =
          taskMetadata?.linearIssue || taskMetadata?.githubIssue || taskMetadata?.jiraIssue;
        let conversationId: string | undefined;

        if (hasIssueContext) {
          try {
            // Get or create default conversation only once
            const convoResult = await window.electronAPI.getOrCreateDefaultConversation(newTask.id);
            if (convoResult?.success && convoResult.conversation?.id) {
              conversationId = convoResult.conversation.id;
            }
          } catch (error) {
            const { log } = await import('./logger');
            log.error('Failed to get or create default conversation:', error as any);
          }
        }

        if (conversationId && taskMetadata?.linearIssue) {
          try {
            const issue = taskMetadata.linearIssue;
            const detailParts: string[] = [];
            const stateName = issue.state?.name?.trim();
            const assigneeName =
              issue.assignee?.displayName?.trim() || issue.assignee?.name?.trim();
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
              id: `linear-context-${newTask.id}`,
              conversationId,
              content: lines.join('\n'),
              sender: 'agent',
              metadata: JSON.stringify({
                isLinearContext: true,
                linearIssue: issue,
              }),
            });
          } catch (seedError) {
            const { log } = await import('./logger');
            log.error('Failed to seed task with Linear issue context:', seedError as any);
          }
        }

        if (conversationId && taskMetadata?.githubIssue) {
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
              id: `github-context-${newTask.id}`,
              conversationId,
              content: lines.join('\n'),
              sender: 'agent',
              metadata: JSON.stringify({
                isGitHubContext: true,
                githubIssue: issue,
              }),
            });
          } catch (seedError) {
            const { log } = await import('./logger');
            log.error('Failed to seed task with GitHub issue context:', seedError as any);
          }
        }

        if (conversationId && taskMetadata?.jiraIssue) {
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

            await window.electronAPI.saveMessage({
              id: `jira-context-${newTask.id}`,
              conversationId,
              content: lines.join('\n'),
              sender: 'agent',
              metadata: JSON.stringify({
                isJiraContext: true,
                jiraIssue: issue,
              }),
            });
          } catch (seedError) {
            const { log } = await import('./logger');
            log.error('Failed to seed task with Jira issue context:', seedError as any);
          }
        }
      })();
      return true;
    }
  } catch (error) {
    const { log } = await import('./logger');
    log.error('Failed to create task:', error as any);
    callbacks.toast({
      title: 'Error',
      description:
        (error as Error)?.message || 'Failed to create task. Please check the console for details.',
    });
    return false;
  }
}
