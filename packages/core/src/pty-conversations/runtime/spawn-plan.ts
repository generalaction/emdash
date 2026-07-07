import { ok, type Result } from '@emdash/shared';
import type { CLIAgentPluginProvider } from '../../agents/plugins';
import type { PtyAgentError } from '../api/schemas';
import type { PtySpawnSpec } from '../transport';
import { ptyErr } from '../errors';
import type { InternalStartInput } from './types';

export type PromptDelivery = CLIAgentPluginProvider['capabilities']['prompt'];
export type KeystrokePromptDelivery = Extract<PromptDelivery, { kind: 'keystroke' }>;

export type SpawnPlan = {
  spec: PtySpawnSpec;
  resolvedSessionId: string;
  commandSession: ResolvedCommandSession;
  promptDelivery: PromptDelivery;
};

type ResolvedCommandSession = {
  sessionId: string;
  providerSessionId?: string;
  isResuming: boolean;
};

export function planSpawn(
  input: InternalStartInput,
  plugin: CLIAgentPluginProvider,
  cli: string
): Result<SpawnPlan, PtyAgentError> {
  const prompt = plugin.behavior.prompt;
  if (!prompt) return ptyErr.noCommand(input.providerId);
  if (input.mode === 'resume' && plugin.capabilities.sessions.kind !== 'resumable') {
    return ptyErr.resumeUnsupported(input.providerId);
  }

  const commandSession = resolveCommandSession(input, plugin.capabilities.sessions);
  const agentCommand = prompt.buildCommand({
    cli,
    extraArgs: input.extraArgs,
    autoApprove: input.autoApprove ?? false,
    initialPrompt: commandSession.isResuming ? undefined : input.initialPrompt,
    sessionId: commandSession.sessionId,
    providerSessionId: commandSession.providerSessionId,
    isResuming: commandSession.isResuming,
    model: input.model ?? '',
  });

  return ok({
    spec: {
      id: input.conversationId,
      command: agentCommand.command,
      args: agentCommand.args,
      cwd: input.cwd,
      env: agentCommand.env,
      cols: input.cols,
      rows: input.rows,
      ...(input.shellSetup !== undefined ? { shellSetup: input.shellSetup } : {}),
      ...(input.tmuxSessionName !== undefined ? { tmuxSessionName: input.tmuxSessionName } : {}),
    },
    resolvedSessionId: commandSession.providerSessionId ?? commandSession.sessionId,
    commandSession,
    promptDelivery: plugin.capabilities.prompt,
  });
}

function resolveCommandSession(
  input: InternalStartInput,
  sessions: CLIAgentPluginProvider['capabilities']['sessions']
): ResolvedCommandSession {
  if (sessions.requiresProviderSessionId === true && input.mode === 'resume') {
    const nativeSessionId = input.sessionId;
    if (nativeSessionId && nativeSessionId !== input.conversationId) {
      return {
        sessionId: nativeSessionId,
        providerSessionId: nativeSessionId,
        isResuming: true,
      };
    }
    return {
      sessionId: input.conversationId,
      providerSessionId: nativeSessionId ?? undefined,
      isResuming: false,
    };
  }

  return {
    sessionId: input.conversationId,
    providerSessionId: input.sessionId ?? undefined,
    isResuming: input.mode === 'resume',
  };
}
