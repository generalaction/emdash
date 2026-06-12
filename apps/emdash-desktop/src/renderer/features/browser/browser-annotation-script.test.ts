import { describe, expect, it } from 'vitest';
import {
  ANNOTATION_CONSOLE_MARKER,
  buildAnnotationPickerScript,
  parseAnnotationMessage,
} from './browser-annotation-script';

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
    expect(parseAnnotationMessage('regular console output')).toBeNull();
    expect(parseAnnotationMessage('{"type":"mode","active":true}')).toBeNull();
  });

  it('ignores marker messages with invalid JSON or unknown types', () => {
    expect(parseAnnotationMessage(`${ANNOTATION_CONSOLE_MARKER}not-json`)).toBeNull();
    expect(parseAnnotationMessage(`${ANNOTATION_CONSOLE_MARKER}{"type":"other"}`)).toBeNull();
    expect(parseAnnotationMessage(`${ANNOTATION_CONSOLE_MARKER}null`)).toBeNull();
  });

  it('parses mode messages', () => {
    const message = `${ANNOTATION_CONSOLE_MARKER}${JSON.stringify({
      type: 'mode',
      active: false,
      cancelled: true,
    })}`;
    expect(parseAnnotationMessage(message)).toEqual({
      type: 'mode',
      active: false,
      cancelled: true,
    });
  });

  it('parses picked messages with element info', () => {
    const message = `${ANNOTATION_CONSOLE_MARKER}${JSON.stringify({
      type: 'picked',
      token: 3,
      element: elementPayload,
    })}`;
    const parsed = parseAnnotationMessage(message);
    expect(parsed).toEqual({ type: 'picked', token: 3, element: elementPayload });
  });

  it('defaults missing React metadata and styles on picked messages', () => {
    const { component: _component, source: _source, styles: _styles, ...legacy } = elementPayload;
    const message = `${ANNOTATION_CONSOLE_MARKER}${JSON.stringify({
      type: 'picked',
      token: 1,
      element: { ...legacy, styles: { display: 'flex', broken: 42 } },
    })}`;
    const parsed = parseAnnotationMessage(message);
    expect(parsed).toEqual({
      type: 'picked',
      token: 1,
      element: { ...legacy, component: null, source: null, styles: { display: 'flex' } },
    });
  });

  it('rejects picked messages with malformed element info', () => {
    const message = `${ANNOTATION_CONSOLE_MARKER}${JSON.stringify({
      type: 'picked',
      token: 3,
      element: { selector: 'div' },
    })}`;
    expect(parseAnnotationMessage(message)).toBeNull();
  });

  it('parses rects messages and drops malformed entries', () => {
    const message = `${ANNOTATION_CONSOLE_MARKER}${JSON.stringify({
      type: 'rects',
      rects: [
        { token: 1, attached: true, rect: { x: 1, y: 2, width: 3, height: 4 } },
        { token: 2, attached: false, rect: null },
        { attached: true },
      ],
    })}`;
    expect(parseAnnotationMessage(message)).toEqual({
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
    expect(buildAnnotationPickerScript({ kind: 'start' })).toContain('.start()');
    expect(buildAnnotationPickerScript({ kind: 'stop' })).toContain('.stop()');
    expect(buildAnnotationPickerScript({ kind: 'untrack', token: 7 })).toContain('.untrack(7)');
    expect(buildAnnotationPickerScript({ kind: 'clear-tracked' })).toContain('.clearTracked()');
    expect(buildAnnotationPickerScript({ kind: 'request-rects' })).toContain('.requestRects()');
  });

  it('floors non-integer tokens to keep the script injection-safe', () => {
    expect(buildAnnotationPickerScript({ kind: 'untrack', token: 7.9 })).toContain('.untrack(7)');
  });

  it('does not leave the command placeholder behind', () => {
    expect(buildAnnotationPickerScript({ kind: 'start' })).not.toContain('__COMMAND__');
  });
});
