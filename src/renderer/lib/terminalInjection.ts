import { INJECT_ENTER_DELAY_MS } from './activityConstants';
import type { Agent } from '../types';

export function buildCommentInjectionPayload(args: {
  providerId: Agent | string;
  inputData: string;
  pendingText: string;
}): { payload: string; submitDelayMs: number } {
  const { providerId, inputData, pendingText } = args;
  const strippedInput = inputData.replace(/[\r\n]+$/g, '');

  // Claude handles raw multiline payloads correctly.
  if (providerId === 'claude') {
    return {
      payload: `${strippedInput}${pendingText}`,
      submitDelayMs: INJECT_ENTER_DELAY_MS,
    };
  }

  // Other providers are safer with bracketed paste.
  // Preserve the leading newline so comments stay clearly separated from user text.
  const bracketedPayload = `\x1b[200~${strippedInput}${pendingText}\x1b[201~`;
  return {
    payload: bracketedPayload,
    submitDelayMs: INJECT_ENTER_DELAY_MS,
  };
}

export function buildPromptInjectionPayload(args: { agent: Agent | string; text: string }): {
  payload: string;
  submitDelayMs: number;
} {
  const { agent, text } = args;
  const trimmed = (text || '').trim();
  const hasMultilinePayload = trimmed.includes('\n');
  const shouldUseBracketedPaste = agent !== 'claude' && hasMultilinePayload;
  const bracketedPayload = `\x1b[200~${trimmed}\x1b[201~`;
  const payload = shouldUseBracketedPaste ? bracketedPayload : trimmed;

  return {
    payload,
    submitDelayMs: INJECT_ENTER_DELAY_MS,
  };
}
