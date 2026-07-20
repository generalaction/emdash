import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shouldSkipAutofocus, TASK_FOCUS_REGION_ATTR } from './region-focus';

describe('shouldSkipAutofocus', () => {
  let dom: JSDOM;

  const build = () => {
    const doc = dom.window.document;
    doc.body.innerHTML = `
      <div id="main" ${TASK_FOCUS_REGION_ATTR}="main">
        <div id="pane-a"><textarea id="main-terminal"></textarea></div>
        <div id="pane-b"><div id="composer" contenteditable="true" tabindex="0"></div></div>
        <button id="tab-button"></button>
      </div>
      <div id="bottom" ${TASK_FOCUS_REGION_ATTR}="bottom">
        <textarea id="drawer-terminal"></textarea>
        <input id="rename-input" />
        <div id="drawer-row" role="button" tabindex="0"></div>
      </div>
      <div id="app-sidebar"><div id="task-row" role="button" tabindex="0"></div></div>
    `;
    return doc;
  };

  beforeEach(() => {
    dom = new JSDOM('<body></body>');
    vi.stubGlobal('document', dom.window.document);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it('does not skip when nothing meaningful has focus', () => {
    const doc = build();
    expect(shouldSkipAutofocus(doc.getElementById('pane-a'))).toBe(false);
    doc.body.focus();
    expect(shouldSkipAutofocus(doc.getElementById('pane-a'))).toBe(false);
  });

  it('skips for a typing surface in the same region outside the caller', () => {
    const doc = build();
    doc.getElementById('composer')!.focus();
    expect(shouldSkipAutofocus(doc.getElementById('pane-a'))).toBe(true);
  });

  it('does not skip when the typing surface is inside ownContainer', () => {
    const doc = build();
    doc.getElementById('main-terminal')!.focus();
    expect(shouldSkipAutofocus(doc.getElementById('pane-a'))).toBe(false);
  });

  it('does not skip for a typing surface in the other region', () => {
    const doc = build();
    doc.getElementById('drawer-terminal')!.focus();
    expect(shouldSkipAutofocus(doc.getElementById('pane-a'))).toBe(false);
  });

  it('skips for a typing surface in the drawer for drawer-region callers', () => {
    const doc = build();
    doc.getElementById('rename-input')!.focus();
    expect(shouldSkipAutofocus(doc.getElementById('drawer-terminal'))).toBe(true);
  });

  it('does not skip for non-typing controls', () => {
    const doc = build();
    doc.getElementById('tab-button')!.focus();
    expect(shouldSkipAutofocus(doc.getElementById('pane-a'))).toBe(false);
    doc.getElementById('drawer-row')!.focus();
    expect(shouldSkipAutofocus(doc.getElementById('drawer-terminal'))).toBe(false);
  });

  it('does not skip for focus outside any region (app sidebar, palette)', () => {
    const doc = build();
    doc.getElementById('task-row')!.focus();
    expect(shouldSkipAutofocus(doc.getElementById('pane-a'))).toBe(false);
  });

  it('with ownContainer null, skips for any focused typing surface in a region', () => {
    const doc = build();
    doc.getElementById('composer')!.focus();
    expect(shouldSkipAutofocus(null)).toBe(true);
    doc.getElementById('task-row')!.focus();
    expect(shouldSkipAutofocus(null)).toBe(false);
  });
});
