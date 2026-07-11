import { describe, expect, it } from 'vitest';
import {
  NATIVE_BROWSER_ACTION_BEGIN,
  NATIVE_BROWSER_ACTION_END,
  nativeBrowserActionPromptFragment,
  parseNativeBrowserAction,
} from './native-browser-protocol';

function actionBlock(payload: unknown): string {
  return `${NATIVE_BROWSER_ACTION_BEGIN}\n${JSON.stringify(payload)}\n${NATIVE_BROWSER_ACTION_END}`;
}

describe('native browser ACP action protocol', () => {
  it('parses exactly one bounded audited action from an ACP turn', () => {
    expect(
      parseNativeBrowserAction(
        `I will inspect the settings control.\n${actionBlock({
          kind: 'click',
          target: { role: 'button', name: 'Save' },
        })}`
      )
    ).toEqual({
      success: true,
      data: { kind: 'click', target: { role: 'button', name: 'Save' } },
    });
  });

  it('rejects malformed, repeated, oversized, and unaudited action requests', () => {
    expect(parseNativeBrowserAction('No structured action')).toMatchObject({
      success: false,
      error: { kind: 'missing-action' },
    });
    expect(
      parseNativeBrowserAction(
        `${actionBlock({ kind: 'keypress', key: 'Enter' })}\n${actionBlock({
          kind: 'keypress',
          key: 'Tab',
        })}`
      )
    ).toMatchObject({ success: false, error: { kind: 'multiple-actions' } });
    expect(
      parseNativeBrowserAction(
        actionBlock({ kind: 'execute-javascript', script: 'document.cookie' })
      )
    ).toMatchObject({ success: false, error: { kind: 'invalid-action' } });
    expect(
      parseNativeBrowserAction(
        actionBlock({
          kind: 'fill',
          target: { role: 'textbox', name: 'Goal' },
          value: 'x'.repeat(16_385),
        })
      )
    ).toMatchObject({ success: false, error: { kind: 'oversized-action' } });
  });

  it('instructs the verifier to use the native one-action handshake without secrets', () => {
    expect(nativeBrowserActionPromptFragment).toContain(NATIVE_BROWSER_ACTION_BEGIN);
    expect(nativeBrowserActionPromptFragment).toContain(NATIVE_BROWSER_ACTION_END);
    expect(nativeBrowserActionPromptFragment).toContain('one action');
    expect(nativeBrowserActionPromptFragment).toContain('Never enter passwords');
    expect(nativeBrowserActionPromptFragment).not.toContain('agent-browser');
    expect(nativeBrowserActionPromptFragment).not.toContain('executeJavaScript');
  });
});
