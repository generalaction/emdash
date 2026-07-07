import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { err, ok, type Result } from '@emdash/shared';
import { providerSupportsAcp } from '@shared/core/agents/agent-acp';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { acpRuntimeProcedures } from '../acp/controller';
import { resolveWorkspace } from '../projects/utils';
import { appSettingsService } from '../settings/settings-service';

const execFileAsync = promisify(execFile);
const MAX_CONTEXT_CHARS = 60_000;
const GIT_CONTEXT_OUTPUT_LIMIT = MAX_CONTEXT_CHARS * 2;

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
      buildCommitContext(workspace.path, input.includeUnstaged)
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
      buildPullRequestContext(workspace.path, input.baseRef, input.branchName)
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
  for (const turn of [...turns].reverse()) {
    for (const item of [...turn.items].reverse()) {
      if (typeof item !== 'object' || item === null) continue;
      if (!('text' in item) || !('role' in item)) continue;
      if (item.role !== 'assistant' || typeof item.text !== 'string') continue;
      if (item.text.trim()) return item.text;
    }
  }
  return null;
}

async function buildCommitContext(cwd: string, includeUnstaged: boolean): Promise<string> {
  const args = includeUnstaged
    ? ['diff', '--stat', '--patch', '--find-renames', 'HEAD']
    : ['diff', '--stat', '--patch', '--find-renames', '--cached'];
  const diff = await gitContext(cwd, args);
  const untracked = includeUnstaged ? await untrackedContext(cwd) : '';
  return truncateContext([diff, untracked].filter(Boolean).join('\n\n'));
}

async function buildPullRequestContext(
  cwd: string,
  base: string,
  branchName: string
): Promise<string> {
  const baseRef = await resolveBaseRef(cwd, base);
  const [log, diff] = await Promise.all([
    git(cwd, ['log', '--oneline', '--decorate', `${baseRef}..HEAD`]),
    gitContext(cwd, ['diff', '--stat', '--patch', '--find-renames', `${baseRef}...HEAD`]),
  ]);
  if (!log.trim() && !diff.trim()) return '';
  return truncateContext(`Commits on ${branchName}:\n${log}\n\nDiff:\n${diff}`);
}

async function resolveBaseRef(cwd: string, base: string): Promise<string> {
  const candidates = [base, `origin/${base}`];
  for (const candidate of candidates) {
    try {
      await git(cwd, ['rev-parse', '--verify', candidate]);
      return candidate;
    } catch {}
  }
  return base;
}

async function untrackedContext(cwd: string): Promise<string> {
  const files = (await git(cwd, ['ls-files', '--others', '--exclude-standard']))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20);
  if (files.length === 0) return '';
  const patches = await Promise.all(
    files.map(async (file) => {
      const content = await gitContext(
        cwd,
        ['diff', '--no-index', '--', '/dev/null', file],
        [0, 1]
      );
      return content;
    })
  );
  return `Untracked files:\n${patches.join('\n')}`;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
  });
  return stdout;
}

async function gitContext(
  cwd: string,
  args: string[],
  successExitCodes: number[] = [0]
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let truncated = false;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length < GIT_CONTEXT_OUTPUT_LIMIT) {
        stdout += chunk.slice(0, GIT_CONTEXT_OUTPUT_LIMIT - stdout.length);
      }
      if (stdout.length >= GIT_CONTEXT_OUTPUT_LIMIT && !truncated) {
        truncated = true;
        child.kill('SIGTERM');
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (truncated || successExitCodes.includes(code ?? 0)) {
        resolve(truncated ? `${stdout}\n\n[Git output truncated]` : stdout);
        return;
      }
      reject(new Error(stderr.trim() || `git ${args.join(' ')} failed with code ${code}`));
    });
  });
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
