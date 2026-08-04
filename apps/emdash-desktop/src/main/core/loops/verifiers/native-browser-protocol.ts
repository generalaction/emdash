import type { LoopBrowserAction } from '@shared/core/loops/loop-browser-contracts';
import { loopBrowserActionSchema } from '@shared/core/loops/loop-browser-contracts';

export const NATIVE_BROWSER_ACTION_BEGIN = '<<<LOOP:NATIVE_BROWSER_ACTION>>>';
export const NATIVE_BROWSER_ACTION_END = '<<<LOOP:NATIVE_BROWSER_ACTION_END>>>';

const MAX_ACTION_PAYLOAD_LENGTH = 20_000;

export type NativeBrowserActionParseError = {
  kind:
    | 'missing-action'
    | 'multiple-actions'
    | 'malformed-action'
    | 'oversized-action'
    | 'invalid-action';
  message: string;
};

export type NativeBrowserActionParseResult =
  | { success: true; data: LoopBrowserAction }
  | { success: false; error: NativeBrowserActionParseError };

export const nativeBrowserActionPromptFragment = `Use Emdash's native browser handshake to inspect the preview. Request exactly one action per turn using this format:

${NATIVE_BROWSER_ACTION_BEGIN}
{"kind":"accessibility-snapshot"}
${NATIVE_BROWSER_ACTION_END}

Use exactly one of these strict JSON payload shapes, with no extra fields:
- {"kind":"navigate","url":"https://exact-allowed-origin/path"}
- {"kind":"accessibility-snapshot"}
- {"kind":"accessibility-query","target":{"role":"button","name":"Save"},"limit":20}
- {"kind":"click","target":{"role":"button","name":"Save"}}
- {"kind":"fill","target":{"role":"textbox","name":"Email"},"value":"non-secret text"}
- {"kind":"keypress","key":"Enter"}
- {"kind":"screenshot","label":"descriptive-label"}
- {"kind":"diagnostics","limit":20}

For target, include at least one of role, name, or testId inside the target object. The optional limit is an integer from 1 through 50. The only keypress values are Enter, Escape, Tab, Space, Backspace, ArrowUp, ArrowDown, ArrowLeft, and ArrowRight. Optional label and limit fields may be omitted. Wait for the bounded observation before requesting another action. Never enter passwords, tokens, secrets, cookies, authorization data, or request bodies. Never request arbitrary JavaScript or filesystem URLs.`;

export function parseNativeBrowserAction(text: string): NativeBrowserActionParseResult {
  const begin = text.indexOf(NATIVE_BROWSER_ACTION_BEGIN);
  if (begin < 0) {
    return failure('missing-action', 'No native browser action was requested');
  }

  const secondBegin = text.indexOf(
    NATIVE_BROWSER_ACTION_BEGIN,
    begin + NATIVE_BROWSER_ACTION_BEGIN.length
  );
  if (secondBegin >= 0) {
    return failure('multiple-actions', 'Only one native browser action is allowed per turn');
  }

  const payloadStart = begin + NATIVE_BROWSER_ACTION_BEGIN.length;
  const end = text.indexOf(NATIVE_BROWSER_ACTION_END, payloadStart);
  if (end < 0) {
    return failure('malformed-action', 'Native browser action is missing its end marker');
  }
  if (text.indexOf(NATIVE_BROWSER_ACTION_END, end + NATIVE_BROWSER_ACTION_END.length) >= 0) {
    return failure('multiple-actions', 'Only one native browser action is allowed per turn');
  }

  const payload = text.slice(payloadStart, end).trim();
  if (payload.length > MAX_ACTION_PAYLOAD_LENGTH) {
    return failure('oversized-action', 'Native browser action exceeds the bounded payload size');
  }

  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return failure('malformed-action', 'Native browser action payload is not valid JSON');
  }

  const parsed = loopBrowserActionSchema.safeParse(value);
  if (!parsed.success) {
    const oversized = parsed.error.issues.some((issue) => issue.code === 'too_big');
    return failure(
      oversized ? 'oversized-action' : 'invalid-action',
      oversized
        ? 'Native browser action exceeds a bounded field size'
        : 'Native browser action is not in the audited action allowlist'
    );
  }

  return { success: true, data: parsed.data };
}

function failure(
  kind: NativeBrowserActionParseError['kind'],
  message: string
): NativeBrowserActionParseResult {
  return { success: false, error: { kind, message } };
}
