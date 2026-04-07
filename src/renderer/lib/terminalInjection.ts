import { INJECT_ENTER_DELAY_MS } from './activityConstants';
import { stripAnsi } from '@shared/text/stripAnsi';
import type { Agent } from '../types';

// ---------------------------------------------------------------------------
// Slow-startup provider configuration
// ---------------------------------------------------------------------------

/** Timing config for providers that need delayed submit handling during startup. */
export interface SlowStartupConfig {
  /** Minimum ms after effect start before sending the prompt. */
  minStartupBeforeSendMs: number;
  /** Interval (ms) between submit-key retries after initial send. */
  retryIntervalMs: number;
  /** Maximum number of submit-key retries. */
  maxSubmitRetries: number;
  /** Cooldown (ms) between idle-triggered submit nudges. */
  idleRetryCooldownMs: number;
  /** Hard-timer fallback (ms) for prompt injection. */
  hardTimerMs: number;
  /** Silence timeout (ms) after pty-started before sending. */
  silenceAfterStartedMs: number;
  /** Safety cap (ms): stop retries after this long regardless. */
  retryDeadlineMs: number;
  /** Skip idle-signal retries (avoids Enter bursts from TUI redraw noise). */
  skipIdleRetries: boolean;
}

const SLOW_STARTUP_CONFIGS: Readonly<Record<string, SlowStartupConfig>> = {
  amp: {
    minStartupBeforeSendMs: 1200,
    retryIntervalMs: 2500,
    maxSubmitRetries: 8,
    idleRetryCooldownMs: 1200,
    hardTimerMs: 3200,
    silenceAfterStartedMs: 1400,
    retryDeadlineMs: 20_000,
    skipIdleRetries: false,
  },
  opencode: {
    minStartupBeforeSendMs: 1800,
    retryIntervalMs: 2200,
    maxSubmitRetries: 4,
    idleRetryCooldownMs: 4000,
    hardTimerMs: 3500,
    silenceAfterStartedMs: 1400,
    retryDeadlineMs: 20_000,
    skipIdleRetries: true,
  },
};

/** Returns the slow-startup config for this provider, or null if it uses normal timing. */
export function getSlowStartupConfig(agent: Agent | string): SlowStartupConfig | null {
  return SLOW_STARTUP_CONFIGS[agent as string] ?? null;
}

export function hasDelayedSubmitStartup(agent: Agent | string): boolean {
  return getSlowStartupConfig(agent) !== null;
}

export function getPromptSubmitDelayMs(agent: Agent | string): number {
  // Some TUIs need extra settling time during startup (e.g. MCP init) before
  // a synthetic Enter is reliably accepted.
  return hasDelayedSubmitStartup(agent) ? 220 : INJECT_ENTER_DELAY_MS;
}

export function buildCommentInjectionPayload(args: {
  providerId: Agent | string;
  inputData: string;
  pendingText: string;
}): { payload: string; submitDelayMs: number } {
  const { providerId, inputData, pendingText } = args;
  // inputData comes from TerminalSessionManager.handleTerminalInput which only
  // strips focus-reporting CSI sequences. After PTY start, raw terminal input
  // can still contain escape sequences (e.g. mouse reporting on click). Strip
  // them so the payload sent to the agent is clean text + comments.
  const strippedInput = stripAnsi(inputData, {
    includePrivateCsiParams: true,
    stripTrailingNewlines: true,
  });

  // Claude and Amp handle raw multiline payloads correctly.
  if (providerId === 'claude' || providerId === 'amp') {
    return {
      payload: `${strippedInput}${pendingText}`,
      submitDelayMs: getPromptSubmitDelayMs(providerId),
    };
  }

  // Other providers are safer with bracketed paste.
  // Preserve the leading newline so comments stay clearly separated from user text.
  const bracketedPayload = `\x1b[200~${strippedInput}${pendingText}\x1b[201~`;
  return {
    payload: bracketedPayload,
    submitDelayMs: getPromptSubmitDelayMs(providerId),
  };
}

export function buildPromptInjectionPayload(args: { agent: Agent | string; text: string }): {
  payload: string;
  submitDelayMs: number;
} {
  const { agent, text } = args;
  const trimmed = (text || '').trim();
  const hasMultilinePayload = trimmed.includes('\n');
  const shouldUseBracketedPaste = agent !== 'claude' && agent !== 'amp' && hasMultilinePayload;
  const bracketedPayload = `\x1b[200~${trimmed}\x1b[201~`;
  const payload = shouldUseBracketedPaste ? bracketedPayload : trimmed;

  return {
    payload,
    submitDelayMs: getPromptSubmitDelayMs(agent),
  };
}

export function getPromptSubmitKey(_agent: Agent | string): '\n' | '\r' {
  return '\r';
}
