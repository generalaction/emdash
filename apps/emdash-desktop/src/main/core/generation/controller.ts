import { randomUUID } from 'node:crypto';
import type { GitChange, GitObjectRef, IGitWorktree } from '@emdash/core/git';
import { err, ok, type Result } from '@emdash/shared';
import { providerSupportsAcp } from '@shared/core/agents/agent-acp';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { acpRuntimeProcedures } from '../acp/controller';
import { resolveWorkspace } from '../projects/utils';
import { appSettingsService } from '../settings/settings-service';

const MAX_CONTEXT_CHARS = 60_000;
const MAX_FILES_IN_CONTEXT = 30;

type GenerationError = {
  type:
    | 'not_found'
    | 'invalid_provider'
    | 'no_changes'
    | 'git_failed'
    | 'acp_failed'
    | 'timeout'
    | 'parse_failed';
  message: string;
};

type CommitMessageResult = { title: string; body: string };
type PullRequestResult = { title: string; body: string };

export const generationController = createRPCController({
  async generateCommitMessage(input: {
    projectId: string;
    workspaceId: string;
    includeUnstaged: boolean;
  }): Promise<Result<CommitMessageResult, GenerationError>> {
    const workspace = resolveWorkspace(input.projectId, input.workspaceId);
    if (!workspace) return err({ type: 'not_found', message: 'Workspace not found.' });

    const contextResult = await buildContext(() =>
      buildCommitContext(workspace.gitWorktree, input.includeUnstaged)
    );
    if (!contextResult.success) return contextResult;
    const context = contextResult.data;
    if (!context.trim()) return err({ type: 'no_changes', message: 'No changes to summarize.' });

    const result = await runJsonGeneration<CommitMessageResult>({
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      cwd: workspace.path,
      kind: 'commit-message',
      prompt: `Generate a concise Git commit message for these changes.

Return only JSON with this exact shape:
{"title":"<imperative conventional commit subject, <=72 chars>","body":"<optional explanatory body, empty string if unnecessary>"}

Use Conventional Commits when the type is clear. Do not include markdown fences.

Changes:
${context}`,
    });
    if (!result.success) return result;
    return normalizeCommitMessageResult(result.data);
  },

  async generatePullRequest(input: {
    projectId: string;
    workspaceId: string;
    baseLabel: string;
    baseRef: string;
    branchName: string;
  }): Promise<Result<PullRequestResult, GenerationError>> {
    const workspace = resolveWorkspace(input.projectId, input.workspaceId);
    if (!workspace) return err({ type: 'not_found', message: 'Workspace not found.' });

    const contextResult = await buildContext(() =>
      buildPullRequestContext(workspace.gitWorktree, input.baseRef, input.branchName)
    );
    if (!contextResult.success) return contextResult;
    const context = contextResult.data;
    if (!context.trim())
      return err({ type: 'no_changes', message: 'No branch changes to summarize.' });

    const result = await runJsonGeneration<PullRequestResult>({
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      cwd: workspace.path,
      kind: 'pull-request',
      prompt: `Generate a pull request title and description for this branch.

Return only JSON with this exact shape:
{"title":"<clear PR title, <=90 chars>","body":"<markdown PR description with summary and testing/notes if evident>"}

Do not invent tests. If testing is not evident, say "Not run (not provided)." in the body.
Do not include markdown fences around the JSON.

Branch: ${input.branchName}
Base: ${input.baseLabel}

Changes:
${context}`,
    });
    if (!result.success) return result;
    return normalizePullRequestResult(result.data);
  },
});

async function buildContext(
  build: () => Promise<string>
): Promise<Result<string, GenerationError>> {
  try {
    return ok(await build());
  } catch (error) {
    return err({
      type: 'git_failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runJsonGeneration<T>(input: {
  projectId: string;
  workspaceId: string;
  cwd: string;
  kind: string;
  prompt: string;
}): Promise<Result<T, GenerationError>> {
  const settings = await appSettingsService.get('generation');
  if (!providerSupportsAcp(settings.provider)) {
    return err({
      type: 'invalid_provider',
      message: `${settings.provider} does not support the ACP runtime.`,
    });
  }

  const conversationId = `generation-${input.kind}-${randomUUID()}`;
  const start = await acpRuntimeProcedures.startSession({
    input: {
      conversationId,
      projectId: input.projectId,
      taskId: input.workspaceId,
      providerId: settings.provider,
      workspaceId: input.workspaceId,
      cwd: input.cwd,
      sessionId: null,
      model: settings.model.trim() || null,
      ephemeral: true,
    },
  });
  if (!start.success) {
    return err({ type: 'acp_failed', message: start.error.message ?? start.error.type });
  }

  try {
    const prompted = await acpRuntimeProcedures.sendPrompt({
      conversationId,
      prompt: { text: input.prompt },
    });
    if (!prompted.success) {
      return err({ type: 'acp_failed', message: prompted.error.message ?? prompted.error.type });
    }
    const history = await acpRuntimeProcedures.getHistory({ conversationId, limit: 10 });
    if (!history.success) {
      return err({ type: 'acp_failed', message: history.error.message ?? history.error.type });
    }
    const text = findLastAssistantMessage(history.data.turns);
    if (!text) return err({ type: 'parse_failed', message: 'The generator returned no text.' });
    return parseJsonObject<T>(text);
  } finally {
    void acpRuntimeProcedures.stopSession({ conversationId });
  }
}

function findLastAssistantMessage(turns: Array<{ items: unknown[] }>): string | null {
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex--) {
    const turn = turns[turnIndex];
    for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex--) {
      const item = turn.items[itemIndex];
      if (typeof item !== 'object' || item === null) continue;
      if (!('text' in item) || !('role' in item)) continue;
      if (item.role !== 'assistant' || typeof item.text !== 'string') continue;
      if (item.text.trim()) return item.text;
    }
  }
  return null;
}

async function buildCommitContext(
  gitWorktree: IGitWorktree,
  includeUnstaged: boolean
): Promise<string> {
  const status = await gitWorktree.getStatus();
  if (status.kind !== 'ok') return '';
  const changes = includeUnstaged ? mergeChanges(status.staged, status.unstaged) : status.staged;
  return truncateContext(buildChangesContext(changes));
}

async function buildPullRequestContext(
  gitWorktree: IGitWorktree,
  base: string,
  branchName: string
): Promise<string> {
  const baseRef = refToObject(base);
  const [log, diff] = await Promise.all([
    gitWorktree.getLog({ base: baseRef, maxCount: 50 }),
    gitWorktree.getChangedFiles({
      base: baseRef,
      head: { kind: 'branch', branch: { type: 'local', branch: branchName } },
    }),
  ]);

  const commits = log.commits
    .map((commit) => `- ${commit.hash.slice(0, 8)} ${commit.subject}`)
    .join('\n');
  const changes = buildChangesContext(diff);
  if (!commits.trim() && !changes.trim()) return '';
  return truncateContext(
    [`Commits on ${branchName}:`, commits || '(none)', '', 'Changes:', changes]
      .filter(Boolean)
      .join('\n')
  );
}

function buildChangesContext(changes: GitChange[]): string {
  const entries = changes.slice(0, MAX_FILES_IN_CONTEXT).map(formatChange);
  const remaining = changes.length - entries.length;
  return [...entries, remaining > 0 ? `\n[${remaining} additional changed file(s) omitted]` : '']
    .filter(Boolean)
    .join('\n\n');
}

function formatChange(change: GitChange): string {
  return `- ${change.status} ${change.path} (+${change.additions}/-${change.deletions})`;
}

function mergeChanges(...groups: GitChange[][]): GitChange[] {
  const merged = new Map<string, GitChange>();
  for (const change of groups.flat()) {
    const existing = merged.get(change.path);
    merged.set(change.path, {
      ...change,
      additions: (existing?.additions ?? 0) + change.additions,
      deletions: (existing?.deletions ?? 0) + change.deletions,
    });
  }
  return [...merged.values()];
}

function refToObject(ref: string): GitObjectRef {
  const slash = ref.indexOf('/');
  if (slash > 0) {
    return {
      kind: 'branch',
      branch: {
        type: 'remote',
        remote: { name: ref.slice(0, slash), url: '' },
        branch: ref.slice(slash + 1),
      },
    };
  }
  return { kind: 'branch', branch: { type: 'local', branch: ref } };
}

function truncateContext(value: string): string {
  if (value.length <= MAX_CONTEXT_CHARS) return value;
  return `${value.slice(0, MAX_CONTEXT_CHARS)}\n\n[Diff truncated]`;
}

function parseJsonObject<T>(text: string): Result<T, GenerationError> {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced ?? trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1);
  try {
    return ok(JSON.parse(candidate) as T);
  } catch {
    return err({ type: 'parse_failed', message: 'Could not parse the generator response.' });
  }
}

function normalizeCommitMessageResult(
  value: CommitMessageResult
): Result<CommitMessageResult, GenerationError> {
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const body = typeof value.body === 'string' ? value.body.trim() : '';
  if (!title) return err({ type: 'parse_failed', message: 'Generated commit title was empty.' });
  return ok({ title, body });
}

function normalizePullRequestResult(
  value: PullRequestResult
): Result<PullRequestResult, GenerationError> {
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const body = typeof value.body === 'string' ? value.body.trim() : '';
  if (!title)
    return err({ type: 'parse_failed', message: 'Generated pull request title was empty.' });
  return ok({ title, body });
}
