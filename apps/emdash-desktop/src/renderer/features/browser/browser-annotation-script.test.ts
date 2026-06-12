import { describe, expect, it } from 'vitest';
import {
  ANNOTATION_CONSOLE_MARKER,
  buildAnnotationPickerScript,
  parseAnnotationMessage,
} from './browser-annotation-script';

const options = { channelId: 'test-channel' };

function signPayload(body: string): string {
  let hash = 2166136261;
  const input = `${options.channelId}\n${body}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function messagePayload(payload: Record<string, unknown>): string {
  const body = JSON.stringify(payload);
  return `${ANNOTATION_CONSOLE_MARKER}${JSON.stringify({ payload, signature: signPayload(body) })}`;
}

const elementPayload = {
  selector: 'form > button.primary',
  tag: 'button',
  id: 'submit',
  classes: ['primary'],
  testId: 'submit-button',
  role: null,
  text: 'Submit',
  html: '<button id="submit" class="primary">Submit</button>',
  rect: { x: 10, y: 20, width: 100, height: 32 },
  component: 'SubmitButton',
  source: 'src/components/SubmitButton.tsx:12',
  styles: { display: 'flex', color: 'rgb(0, 0, 0)' },
};

describe('parseAnnotationMessage', () => {
  it('ignores messages without the marker prefix', () => {
    expect(parseAnnotationMessage('regular console output', options)).toBeNull();
    expect(parseAnnotationMessage('{"type":"mode","active":true}', options)).toBeNull();
  });

  it('ignores marker messages with invalid JSON or unknown types', () => {
    expect(parseAnnotationMessage(`${ANNOTATION_CONSOLE_MARKER}not-json`, options)).toBeNull();
    expect(parseAnnotationMessage(messagePayload({ type: 'other' }), options)).toBeNull();
    expect(parseAnnotationMessage(`${ANNOTATION_CONSOLE_MARKER}null`, options)).toBeNull();
  });

  it('rejects unsigned payloads even when page code learns a prior message body', () => {
    const forged = `${ANNOTATION_CONSOLE_MARKER}${JSON.stringify({
      payload: { type: 'mode', active: true },
      signature: 'bad-signature',
    })}`;
    expect(parseAnnotationMessage(forged, options)).toBeNull();
  });

  it('parses mode messages', () => {
    const message = messagePayload({
      type: 'mode',
      active: false,
      cancelled: true,
    });
    expect(parseAnnotationMessage(message, options)).toEqual({
      type: 'mode',
      active: false,
      cancelled: true,
    });
  });

  it('parses picked messages with element info', () => {
    const message = messagePayload({
      type: 'picked',
      token: 3,
      element: elementPayload,
    });
    const parsed = parseAnnotationMessage(message, options);
    expect(parsed).toEqual({ type: 'picked', token: 3, element: elementPayload });
  });

  it('defaults missing React metadata and styles on picked messages', () => {
    const { component: _component, source: _source, styles: _styles, ...legacy } = elementPayload;
    const message = messagePayload({
      type: 'picked',
      token: 1,
      element: { ...legacy, styles: { display: 'flex', broken: 42 } },
    });
    const parsed = parseAnnotationMessage(message, options);
    expect(parsed).toEqual({
      type: 'picked',
      token: 1,
      element: { ...legacy, component: null, source: null, styles: { display: 'flex' } },
    });
  });

  it('rejects picked messages with malformed element info', () => {
    const message = messagePayload({
      type: 'picked',
      token: 3,
      element: { selector: 'div' },
    });
    expect(parseAnnotationMessage(message, options)).toBeNull();
  });

  it('parses rects messages and drops malformed entries', () => {
    const message = messagePayload({
      type: 'rects',
      rects: [
        { token: 1, attached: true, rect: { x: 1, y: 2, width: 3, height: 4 } },
        { token: 2, attached: false, rect: null },
        { attached: true },
      ],
    });
    expect(parseAnnotationMessage(message, options)).toEqual({
      type: 'rects',
      rects: [
        { token: 1, attached: true, rect: { x: 1, y: 2, width: 3, height: 4 } },
        { token: 2, attached: false, rect: null },
      ],
    });
  });
});

describe('buildAnnotationPickerScript', () => {
  it('embeds the requested command', () => {
    expect(buildAnnotationPickerScript({ kind: 'start' }, options)).toContain('.start()');
    expect(buildAnnotationPickerScript({ kind: 'stop' }, options)).toContain('.stop()');
    expect(buildAnnotationPickerScript({ kind: 'untrack', token: 7 }, options)).toContain(
      '.untrack(7)'
    );
    expect(buildAnnotationPickerScript({ kind: 'clear-tracked' }, options)).toContain(
      '.clearTracked()'
    );
    expect(buildAnnotationPickerScript({ kind: 'request-rects' }, options)).toContain(
      '.requestRects()'
    );
  });

  it('floors non-integer tokens to keep the script injection-safe', () => {
    expect(buildAnnotationPickerScript({ kind: 'untrack', token: 7.9 }, options)).toContain(
      '.untrack(7)'
    );
  });

  it('does not leave the command placeholder behind', () => {
    const script = buildAnnotationPickerScript({ kind: 'start' }, options);
    expect(script).not.toContain('__COMMAND__');
    expect(script).not.toContain('__CHANNEL_ID__');
  });
});
