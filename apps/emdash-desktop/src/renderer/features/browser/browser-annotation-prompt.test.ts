import { describe, expect, it } from 'vitest';
import { buildAnnotationPrompt } from './browser-annotation-prompt';
import type { BrowserAnnotation } from './browser-annotation-types';

function makeAnnotation(overrides: Partial<BrowserAnnotation> = {}): BrowserAnnotation {
  return {
    token: 1,
    epoch: 0,
    comment: 'Make this button blue',
    pageUrl: 'http://localhost:5173/',
    element: {
      selector: 'form > button.primary',
      tag: 'button',
      id: 'submit',
      classes: ['primary'],
      testId: 'submit-button',
      role: 'button',
      text: 'Submit',
      html: '<button id="submit">Submit</button>',
      rect: { x: 0, y: 0, width: 100, height: 32 },
      component: 'SubmitButton',
      source: 'src/components/SubmitButton.tsx:12',
      styles: { display: 'flex', color: 'rgb(255, 0, 0)' },
    },
    ...overrides,
  };
}

describe('buildAnnotationPrompt', () => {
  it('formats a single annotation with element details', () => {
    const prompt = buildAnnotationPrompt([makeAnnotation()]);
    expect(prompt).toBe(
      [
        'I annotated UI elements in the running app preview. Implement the requested change for each annotated element.',
        '',
        'Page: http://localhost:5173/',
        '',
        '1. Make this button blue',
        '   Element: form > button.primary',
        '   Component: SubmitButton (src/components/SubmitButton.tsx:12)',
        '   Attributes: data-testid="submit-button", role="button"',
        '   Text: "Submit"',
        '   Styles: display: flex; color: rgb(255, 0, 0)',
        '   HTML: <button id="submit">Submit</button>',
      ].join('\n')
    );
  });

  it('numbers annotations sequentially and groups by page URL', () => {
    const prompt = buildAnnotationPrompt([
      makeAnnotation({ token: 1, comment: 'First change' }),
      makeAnnotation({
        token: 2,
        comment: 'Second change',
        pageUrl: 'http://localhost:5173/about',
      }),
      makeAnnotation({ token: 3, comment: 'Third change' }),
    ]);

    expect(prompt).toContain('Page: http://localhost:5173/');
    expect(prompt).toContain('Page: http://localhost:5173/about');
    expect(prompt).toContain('1. First change');
    expect(prompt).toContain('2. Second change');
    expect(prompt).toContain('3. Third change');
  });

  it('omits empty optional element details', () => {
    const prompt = buildAnnotationPrompt([
      makeAnnotation({
        element: {
          selector: 'div',
          tag: 'div',
          id: null,
          classes: [],
          testId: null,
          role: null,
          text: '',
          html: '',
          rect: { x: 0, y: 0, width: 10, height: 10 },
          component: null,
          source: null,
          styles: {},
        },
      }),
    ]);
    expect(prompt).not.toContain('Attributes:');
    expect(prompt).not.toContain('Text:');
    expect(prompt).not.toContain('HTML:');
    expect(prompt).not.toContain('Component:');
    expect(prompt).not.toContain('Styles:');
  });

  it('falls back to a Source line when only the JSX source is known', () => {
    const prompt = buildAnnotationPrompt([
      makeAnnotation({
        element: {
          ...makeAnnotation().element,
          component: null,
          source: 'src/App.tsx:7',
        },
      }),
    ]);
    expect(prompt).toContain('   Source: src/App.tsx:7');
    expect(prompt).not.toContain('Component:');
  });

  it('does not wrap selectors or HTML in shell-active backticks', () => {
    const prompt = buildAnnotationPrompt([
      makeAnnotation({
        element: {
          ...makeAnnotation().element,
          html: '<div data-auth_type="SIGN_UP">Outlet</div>',
        },
      }),
    ]);

    expect(prompt).not.toContain('`');
    expect(prompt).toContain('data-auth_type="SIGN_UP"');
  });

  it('builds a compact initial prompt for new agents', () => {
    const prompt = buildAnnotationPrompt(
      [
        makeAnnotation({
          comment: 'Change this\nnow',
          element: {
            ...makeAnnotation().element,
            html: '<div data-auth_type="SIGN_UP">Outlet</div>',
          },
        }),
      ],
      { mode: 'initial' }
    );

    expect(prompt).not.toContain('\n');
    expect(prompt).not.toContain('`');
    expect(prompt).not.toContain('HTML:');
    expect(prompt).toContain('Change this now');
    expect(prompt).toContain('selector: form > button.primary');
  });
});
