import type { CanonicalHookEvent } from '@emdash/core/services/agent-plugins/api/plugins';
import {
  buildFlatJsonHookConfig,
  configRoots,
  defaultHookEventParser,
  extractProviderSessionId,
  homeConfigRoot,
  type HookCommandOptions,
  makeStdinHookCommand,
} from '@emdash/core/services/agent-plugins/api/plugins/helpers';

/** User-level Cursor hooks live at `~/.cursor/hooks.json`. */
export const CURSOR_HOOKS_PATH = 'hooks.json';

/**
 * Cursor agent hooks always carry `conversation_id`; `sessionStart` also
 * includes `session_id` (same value). Prefer the shared extractors, then fall
 * back to Cursor's conversation id so resume tracking still works.
 */
function cursorProviderSessionId(body: Record<string, unknown>): string | undefined {
  const fromCommon = extractProviderSessionId(body);
  if (fromCommon) return fromCommon;
  const conversationId = body.conversation_id;
  return typeof conversationId === 'string' && conversationId.trim()
    ? conversationId.trim()
    : undefined;
}

/**
 * Cursor's `stop` payload includes `status: completed | aborted | error`.
 * Map errors distinctly; treat aborted like a normal stop so the sidebar
 * clears instead of staying on the input-inferred working spinner.
 */
export function parseCursorHookEvent(
  eventType: string,
  body: Record<string, unknown>
): CanonicalHookEvent {
  const providerSessionId = cursorProviderSessionId(body);

  if (eventType === 'stop') {
    if (body.status === 'error') {
      return {
        kind: 'status',
        type: 'error',
        providerSessionId,
        message: typeof body.message === 'string' ? body.message : undefined,
      };
    }
    return { kind: 'status', type: 'stop', providerSessionId };
  }

  const event = defaultHookEventParser(eventType, body);
  if (event.kind === 'ignore') return event;
  if (event.kind === 'session') {
    return providerSessionId ? { kind: 'session', providerSessionId } : event;
  }
  return providerSessionId ? { ...event, providerSessionId } : event;
}

/**
 * Cursor Agent loads `~/.cursor/hooks.json` (and project `.cursor/hooks.json`).
 * Commands receive JSON on stdin; we must not leak the hook-server HTTP body
 * onto stdout — `stop` treats a non-empty `followup_message` as an auto-prompt,
 * and `beforeSubmitPrompt` can block submission when `continue` is false.
 */
export function buildCursorHookConfig(opts: HookCommandOptions = {}) {
  const startCmd = makeStdinHookCommand('start', {
    ...opts,
    stdoutJson: { continue: true },
  });
  const stopCmd = makeStdinHookCommand('stop', {
    ...opts,
    stdoutJson: {},
  });
  const sessionCmd = makeStdinHookCommand('session-start', {
    ...opts,
    stdoutJson: {},
  });

  return {
    ...buildFlatJsonHookConfig(
      CURSOR_HOOKS_PATH,
      [
        { hookKey: 'sessionStart', command: sessionCmd },
        { hookKey: 'beforeSubmitPrompt', command: startCmd },
        { hookKey: 'stop', command: stopCmd },
      ],
      { version: 1 }
    ),
    resolveConfigRoots: configRoots(homeConfigRoot('.cursor')),
    parseHookEvent: parseCursorHookEvent,
  };
}
