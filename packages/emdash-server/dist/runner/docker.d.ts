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
export declare function buildContainerScript(automation: Automation): string;
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
export declare function buildDockerArgv(opts: BuildArgvOptions): string[];
/**
 * Runs an automation in a Docker container. Spawns `docker` (NOT node-pty),
 * captures stdout/stderr, and enforces the automation timeout by killing the
 * process group. Returns the result; never throws for a non-zero exit.
 */
export declare function runAgentInDocker(opts: BuildArgvOptions, spawnImpl?: typeof spawn): Promise<RunResult>;
