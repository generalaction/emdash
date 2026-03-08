import { getProvider, type ProviderId } from '@shared/providers/registry';

export interface AgentCommandOptions {
  providerId: ProviderId;
  /** Pass the provider's autoApproveFlag (e.g. --dangerously-skip-permissions). */
  autoApprove?: boolean;
  /** Append the provider's resumeFlag and skip prompt args. */
  resume?: boolean;
  /**
   * Initial prompt text.
   * Omitted when provider uses useKeystrokeInjection (Amp, OpenCode)
   * or when resume is true.
   */
  initialPrompt?: string;
  /**
   * Provider-native session ID (e.g. Claude's --session-id value).
   * Only applied when the provider has sessionIdFlag defined.
   */
  sessionId?: string;
}

/**
 * Build the CLI command and argument list for an agent provider.
 *
 * Handles:
 * - autoApproveFlag   — appended when autoApprove is true
 * - sessionIdFlag     — appended with value when sessionId is provided
 * - resumeFlag        — appended when resume is true (prompt args skipped)
 * - initialPromptFlag — empty string means positional; non-empty string means flag+value
 * - useKeystrokeInjection — prompt is NOT added to args (injected via keystrokes after start)
 * - defaultArgs       — always prepended (even during resume)
 * - autoStartCommand  — used for providers without a plain `cli` field (e.g. rovo)
 */
export function buildAgentCommand(opts: AgentCommandOptions): { command: string; args: string[] } {
  const provider = getProvider(opts.providerId);

  // Determine the binary to run
  let command = provider?.cli ?? opts.providerId;
  const args: string[] = [];

  // Providers like rovo have no `cli` but an `autoStartCommand` (e.g. 'acli rovodev run')
  if (!provider?.cli && provider?.autoStartCommand) {
    const parts = provider.autoStartCommand.trim().split(/\s+/);
    command = parts[0];
    args.push(...parts.slice(1));
  }

  // Default args come first (applies in both normal and resume mode)
  if (provider?.defaultArgs?.length) {
    args.push(...provider.defaultArgs);
  }

  // Resume mode: append resumeFlag tokens and return early (no prompt args)
  if (opts.resume && provider?.resumeFlag) {
    args.push(...provider.resumeFlag.trim().split(/\s+/));
    return { command, args };
  }

  // Auto-approve
  if (opts.autoApprove && provider?.autoApproveFlag) {
    args.push(provider.autoApproveFlag);
  }

  // Provider-native session isolation (e.g. Claude --session-id <uuid>)
  if (opts.sessionId && provider?.sessionIdFlag) {
    args.push(provider.sessionIdFlag, opts.sessionId);
  }

  // Initial prompt — skip entirely for keystroke-injection providers
  if (opts.initialPrompt && !provider?.useKeystrokeInjection) {
    if (provider?.initialPromptFlag !== undefined && provider.initialPromptFlag !== '') {
      // Flag-based: e.g. '-i', '--prompt', '-p'
      args.push(provider.initialPromptFlag, opts.initialPrompt);
    } else if (provider?.initialPromptFlag === '') {
      // Positional: append as the last argument
      args.push(opts.initialPrompt);
    }
    // If initialPromptFlag is undefined the provider has no prompt mechanism
  }

  return { command, args };
}
