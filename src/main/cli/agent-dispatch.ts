/**
 * Launches a coding agent for a conversation inside a DETACHED tmux session,
 * reusing the app's own command builder so the invocation is identical to what
 * the app would spawn. Because the tmux session name is derived deterministically
 * from the conversation id, the app re-attaches to this same session when the
 * task is later opened.
 *
 * Command construction is pure (no db / Electron), so it's unit-testable; the
 * caller (the CLI entry) resolves the provider config + env and passes them in.
 *
 * Secrets (API keys) are delivered via a 0600 temp file the agent sources +
 * deletes at launch — NOT via `tmux -e KEY=VALUE`, which would expose them in
 * the tmux process argv (visible to `ps`) and in the session environment.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildAgentSessionCommand } from '@main/core/conversations/impl/agent-command';
import { makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import { quoteShellArg } from '@main/utils/shellEscape';
import { getProvider, type AgentProviderId } from '@shared/agent-provider-registry';
import type { ProviderCustomConfig } from '@shared/app-settings';
import { makePtySessionId } from '@shared/ptySessionId';

export type AgentDispatchInput = {
  projectId: string;
  taskId: string;
  conversationId: string;
  providerId: AgentProviderId;
  /** Resolved provider config (registry defaults merged with user overrides). */
  providerConfig: ProviderCustomConfig | undefined;
  autoApprove: boolean;
  prompt: string;
  /** Worktree directory the agent runs in. */
  cwd: string;
  /** Agent env (API keys, PATH, …); written to a temp file the agent sources. */
  env: Record<string, string>;
  shellSetup?: string;
};

export type AgentDispatchResult = {
  /** The tmux session is up (spawned now or already running). */
  delivered: boolean;
  /** Whether the prompt was delivered at launch (false for keystroke-only providers). */
  promptDelivered: boolean;
  tmuxSession: string;
  reason?: 'spawn-failed' | 'keystroke-provider';
  alreadyRunning?: boolean;
};

export type AgentSpawnRunner = {
  hasSession(name: string): boolean;
  /** Writes env to a private temp file (sourced at launch) and returns its path. */
  writeEnvFile(env: Record<string, string>): string;
  spawn(tmuxArgs: string[]): { ok: boolean; error?: string };
};

const defaultRunner: AgentSpawnRunner = {
  hasSession: (name) =>
    spawnSync('tmux', ['has-session', '-t', name], { stdio: 'ignore' }).status === 0,
  writeEnvFile: (env) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-agent-'));
    const file = path.join(dir, 'env.sh');
    const body = Object.entries(env)
      .map(([key, value]) => `export ${key}=${quoteShellArg(value)}`)
      .join('\n');
    fs.writeFileSync(file, `${body}\n`, { mode: 0o600 });
    return file;
  },
  spawn: (tmuxArgs) => {
    const r = spawnSync('tmux', tmuxArgs, { stdio: 'ignore' });
    return { ok: r.status === 0, error: r.error?.message };
  },
};

/**
 * Pure: builds the `tmux new-session` argv that launches the agent detached.
 * The agent command is built exactly as the app builds it (auto-approve flag,
 * initial-prompt flag / trailing-arg / stdin-pipe per provider), wrapped in the
 * project's shellSetup. Env is sourced from `envFilePath` (then the file is
 * removed) so secrets never appear in argv.
 */
export function buildAgentTmuxArgv(
  input: AgentDispatchInput,
  opts: { envFilePath: string }
): { tmuxSession: string; argv: string[] } {
  const tmuxSession = makeTmuxSessionName(
    makePtySessionId(input.projectId, input.taskId, input.conversationId)
  );
  const { command, args } = buildAgentSessionCommand({
    providerId: input.providerId,
    providerConfig: input.providerConfig,
    autoApprove: input.autoApprove,
    initialPrompt: input.prompt,
    sessionId: input.conversationId,
    isResuming: false,
  });
  const agentLine = [command, ...args].map(quoteShellArg).join(' ');
  const quotedEnv = quoteShellArg(opts.envFilePath);
  const setup = input.shellSetup ? `${input.shellSetup} && ` : '';
  // Source the env file, delete it immediately, then run the agent.
  const fullLine = `. ${quotedEnv}; rm -f ${quotedEnv}; ${setup}${agentLine}`;

  const argv = ['new-session', '-d', '-s', tmuxSession, '-c', input.cwd, fullLine];
  return { tmuxSession, argv };
}

/**
 * Spawns the agent in a detached tmux session (idempotent: if the session
 * already exists, treats it as up). Returns whether the prompt was delivered at
 * launch — false for keystroke-only providers (grok/hermes/…), which the app
 * injects after the TUI settles; for those, follow up with `workspace send`.
 */
export async function dispatchAgent(
  input: AgentDispatchInput,
  runner: AgentSpawnRunner = defaultRunner
): Promise<AgentDispatchResult> {
  const tmuxSession = makeTmuxSessionName(
    makePtySessionId(input.projectId, input.taskId, input.conversationId)
  );
  const promptAtLaunch = !getProvider(input.providerId)?.useKeystrokeInjection;

  if (runner.hasSession(tmuxSession)) {
    return { delivered: true, promptDelivered: promptAtLaunch, tmuxSession, alreadyRunning: true };
  }

  const envFilePath = runner.writeEnvFile(input.env);
  const { argv } = buildAgentTmuxArgv(input, { envFilePath });
  const result = runner.spawn(argv);
  if (!result.ok) {
    return { delivered: false, promptDelivered: false, tmuxSession, reason: 'spawn-failed' };
  }
  return {
    delivered: true,
    promptDelivered: promptAtLaunch,
    tmuxSession,
    reason: promptAtLaunch ? undefined : 'keystroke-provider',
  };
}
