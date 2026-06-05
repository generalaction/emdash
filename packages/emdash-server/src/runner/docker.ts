import { spawn } from 'node:child_process';
import type { Automation } from '../config.js';

export interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface BuildArgvOptions {
  automation: Automation;
  oauthToken: string;
  /** Host uid:gid so files written in the mounted repo are owned by the host user. */
  uid: number;
  gid: number;
}

/**
 * Builds the shell command run *inside* the container: pull, optionally
 * checkout a branch, run claude headless, optionally push.
 *
 * `claude -p` is non-interactive (no PTY needed). `--dangerously-skip-permissions`
 * lets it act without prompting. The prompt is passed as a single argv item by
 * the outer `docker run` (see buildDockerArgv), so we reference it positionally
 * via "$PROMPT" exported below — avoiding any shell-quoting of user content.
 */
export function buildContainerScript(automation: Automation): string {
  const lines: string[] = ['set -euo pipefail'];
  lines.push('git config --global --add safe.directory /work');
  lines.push('git pull --ff-only || true');
  if (automation.branch) {
    // Create or switch to the branch before the agent runs.
    lines.push(`git checkout -B ${shSingleQuote(automation.branch)}`);
  }
  // Prompt arrives via the PROMPT env var (set by docker -e) to avoid quoting
  // issues with arbitrary prompt text.
  lines.push('claude -p "$PROMPT" --dangerously-skip-permissions');
  if (automation.push) {
    lines.push('git push');
  }
  return lines.join('\n');
}

/**
 * Builds the full `docker run` argv array. Pure — no spawning — so it can be
 * unit-tested exactly.
 *
 * Security-critical properties (asserted by tests):
 * - `--rm`: throwaway container.
 * - `-u uid:gid`: commits owned by the host user, not root.
 * - Env allowlist: ONLY CLAUDE_CODE_OAUTH_TOKEN + PROMPT are passed. In
 *   particular NO ANTHROPIC_API_KEY (which would outrank the OAuth token per
 *   Claude docs) and no inherited host env.
 * - Repo mounted at /work; working dir /work.
 */
export function buildDockerArgv(opts: BuildArgvOptions): string[] {
  const { automation, oauthToken, uid, gid } = opts;
  return [
    'run',
    '--rm',
    '-u',
    `${uid}:${gid}`,
    '-v',
    `${automation.repoPath}:/work`,
    '-w',
    '/work',
    // Env allowlist — explicit, never `--env-file` or host passthrough.
    '-e',
    `CLAUDE_CODE_OAUTH_TOKEN=${oauthToken}`,
    '-e',
    `PROMPT=${automation.prompt}`,
    // HOME so claude can write its config/cache inside the container as the
    // mapped uid (which has no /etc/passwd entry); /tmp is always writable.
    '-e',
    'HOME=/tmp',
    automation.image,
    'bash',
    '-lc',
    buildContainerScript(automation),
  ];
}

/** Single-quote a string for safe embedding in a POSIX shell command. */
function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Runs an automation in a Docker container. Spawns `docker` (NOT node-pty),
 * captures stdout/stderr, and enforces the automation timeout by killing the
 * process group. Returns the result; never throws for a non-zero exit.
 */
export function runAgentInDocker(
  opts: BuildArgvOptions,
  spawnImpl: typeof spawn = spawn
): Promise<RunResult> {
  const argv = buildDockerArgv(opts);
  return new Promise<RunResult>((resolve) => {
    const child = spawnImpl('docker', argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.automation.timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err: Error) => {
      clearTimeout(timer);
      resolve({
        exitCode: null,
        stdout,
        stderr: stderr + `\n[runner] failed to spawn docker: ${err.message}`,
        timedOut,
      });
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr, timedOut });
    });
  });
}
