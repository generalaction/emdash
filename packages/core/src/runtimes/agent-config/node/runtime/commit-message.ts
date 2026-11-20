import { err, ok, type Result } from '@emdash/shared';
import type { AgentConfigAuthError } from '#runtimes/agent-config/api';
import type { AgentPluginHost } from '#services/agent-plugins/api/plugins';
import { createBoundExec, NodeExecutionContext } from '#services/exec/api';

// ponytail: a 1-2 line commit doesn't need more; bigger diffs only cost the model time.
const DIFF_LIMIT = 20_000;
const TIMEOUT_MS = 120_000;

export function buildCommitMessagePrompt(input: {
  status: string;
  diff: string;
  recentSubjects: string;
}): string {
  const diff =
    input.diff.length > DIFF_LIMIT
      ? `${input.diff.slice(0, DIFF_LIMIT)}\n[diff truncated]`
      : input.diff;
  return [
    'Write a git commit message for the changes below.',
    'Always write it in English, even if the recent commit subjects use another language.',
    'Copy only the format (prefix, scope, casing) of the recent commit subjects, never their language.',
    'Reply with the commit message only: no quotes, no code fences, no explanation,',
    'no trailers such as Co-Authored-By.',
    'Use a single subject line unless the change clearly needs a short body.',
    '',
    'Recent commit subjects (format reference only; ignore their language, translate to English):',
    input.recentSubjects.trim() || '(none)',
    '',
    'Changed files (git status --short):',
    input.status.trim(),
    '',
    'Diff:',
    diff,
    '',
    // Restated last: small models drift to the language of the recent subjects above.
    'Reminder: the commit message must be in English.',
  ].join('\n');
}

/** Strips a wrapping code fence some CLIs add despite the instructions. */
export function cleanCommitMessage(output: string): string {
  return output
    .trim()
    .replace(/^```[\w-]*\n([\s\S]*?)\n```$/, '$1')
    .trim();
}

/** Runs the provider CLI one-shot in `cwd` over the staged diff (or every change when nothing is
 * staged, matching the commit card, which then stages everything). */
export async function generateCommitMessage(
  agentHost: AgentPluginHost,
  providerId: string,
  cwd: string
): Promise<Result<{ message: string }, AgentConfigAuthError>> {
  const plugin = agentHost.get(providerId);
  if (!plugin) return err({ type: 'unknown-provider', providerId });
  const oneShotArgs = plugin.behavior.prompt?.oneShotArgs;
  if (!oneShotArgs) {
    return err({
      type: 'invalid-state',
      message: `${plugin.metadata.name} does not support commit message generation`,
    });
  }
  const spawn = await agentHost.resolveSpawnContext(providerId);
  if (!spawn.success) {
    return err({ type: 'invalid-state', message: `${plugin.metadata.name} CLI not found` });
  }
  const env = spawn.data.agentEnv;
  const exec = new NodeExecutionContext({ root: cwd, env });
  try {
    const git = async (...args: string[]) => (await exec.exec('git', args, { env })).stdout;
    const [staged, status, recentSubjects] = await Promise.all([
      git('diff', '--cached'),
      git('status', '--short'),
      git('log', '-10', '--format=%s').catch(() => ''),
    ]);
    const prompt = buildCommitMessagePrompt({
      status,
      diff: staged.trim() ? staged : await git('diff', 'HEAD'),
      recentSubjects,
    });
    const stdout = await runWithStdin(spawn.data.cli, oneShotArgs(), cwd, env, prompt);
    const message = cleanCommitMessage(stdout);
    if (!message) return err({ type: 'invalid-state', message: 'The agent returned no message' });
    return ok({ message });
  } catch (error) {
    return err({
      type: 'invalid-state',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** The prompt goes in on stdin, which is then closed: CLIs such as `claude -p` otherwise wait
 * 3s for stdin data, and argv would cap the prompt size. */
async function runWithStdin(
  cli: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  input: string
): Promise<string> {
  const child = await createBoundExec({ file: cli, cwd, env }).spawn(args, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // A CLI that exits early (not logged in, bad flag) closes stdin: EPIPE is reported by its exit code.
  child.stdin.on('error', () => undefined);
  child.stdin.end(input);
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  if (code !== 0) throw new Error(stderr.trim() || `${cli} exited with code ${code}`);
  return stdout;
}
