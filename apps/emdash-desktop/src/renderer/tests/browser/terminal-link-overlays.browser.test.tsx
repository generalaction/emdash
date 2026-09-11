import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifySelectionLink,
  type SelectionLinkKind,
} from '@core/features/terminals/browser/pty/selection-link';
import { TerminalLinkTooltip } from '@core/features/terminals/browser/pty/terminal-link-tooltip';
import { TerminalSelectionPopover } from '@core/features/terminals/browser/pty/terminal-selection-popover';

const noop = () => {};
const alwaysCopies = async () => true;

function Harness(props: {
  visible: boolean;
  text: string;
  x: number;
  y: number;
  linkKind: SelectionLinkKind;
  onOpenFile?: (rawPath: string) => void;
  onShowInFileManager?: (rawPath: string) => void;
  onOpenInBrowser?: (url: string) => void;
  onOpenUrl?: (url: string) => void;
  onClose?: () => void;
}) {
  return (
    <TerminalSelectionPopover
      visible={props.visible}
      x={props.x}
      y={props.y}
      text={props.text}
      linkKind={props.linkKind}
      isLocalWorkspace
      onCopy={alwaysCopies}
      onOpenFile={props.onOpenFile ?? noop}
      onShowInFileManager={props.onShowInFileManager ?? noop}
      onOpenInBrowser={props.onOpenInBrowser ?? noop}
      onOpenUrl={props.onOpenUrl ?? noop}
      onClose={props.onClose ?? noop}
    />
  );
}

describe('TerminalSelectionPopover (browser)', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal('electronAPI', {
      eventOn: vi.fn(() => () => {}),
      eventSend: vi.fn(),
      invoke: vi.fn(() => Promise.resolve({ success: true, data: null })),
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    root.unmount();
    host.remove();
    document.body.textContent = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows Copy, Open in Browser and Open URL for a URL selection', async () => {
    const linkKind = classifySelectionLink('https://example.com/docs');
    await new Promise<void>((resolve) => {
      root.render(
        React.createElement(Harness, {
          visible: true,
          text: 'https://example.com/docs',
          x: 100,
          y: 100,
          linkKind,
        })
      );
      setTimeout(resolve, 50);
    });

    const labels = [...document.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('Copy');
    expect(labels).toContain('Open in Browser');
    expect(labels).toContain('Open URL');
    expect(labels).not.toContain('Open in Pane');
    expect(labels).not.toContain('Show in Explorer');
  });

  it('shows Copy, Open in Pane and Show in Explorer for a file selection and opens via the seam', async () => {
    const opened: string[] = [];
    await new Promise<void>((resolve) => {
      root.render(
        React.createElement(Harness, {
          visible: true,
          text: 'src/app.ts:42',
          x: 100,
          y: 100,
          linkKind: classifySelectionLink('src/app.ts:42'),
          onOpenFile: (raw) => opened.push(raw),
        })
      );
      setTimeout(resolve, 50);
    });

    const labels = [...document.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('Copy');
    expect(labels).toContain('Open in Pane');
    expect(labels).toContain('Show in Explorer');
    expect(labels).not.toContain('Open in Browser');

    const openButton = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Open in Pane'
    );
    openButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(opened).toEqual(['src/app.ts:42']);
  });

  it('closes on outside mousedown', async () => {
    const closed = vi.fn();
    await new Promise<void>((resolve) => {
      root.render(
        React.createElement(Harness, {
          visible: true,
          text: '/tmp/report.md',
          x: 100,
          y: 100,
          linkKind: classifySelectionLink('/tmp/report.md'),
          onClose: closed,
        })
      );
      setTimeout(resolve, 50);
    });

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(closed).toHaveBeenCalled();
  });
});

describe('TerminalLinkTooltip (browser)', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    root.unmount();
    host.remove();
    document.body.textContent = '';
  });

  it('renders the resolved path and modifier hint and flips above the cursor near the bottom', async () => {
    await new Promise<void>((resolve) => {
      root.render(
        React.createElement(TerminalLinkTooltip, {
          visible: true,
          x: 200,
          y: window.innerHeight - 10,
          linkText: '/repo/src/app.ts',
          hint: '⌘+Click to open',
        })
      );
      setTimeout(resolve, 50);
    });

    const tooltip = document.querySelector('[role="tooltip"]');
    expect(tooltip?.textContent).toContain('/repo/src/app.ts');
    expect(tooltip?.textContent).toContain('⌘+Click to open');
    const top = (tooltip as HTMLElement | null)?.getBoundingClientRect().top ?? Number.NaN;
    expect(top).toBeLessThan(window.innerHeight - 10);
  });
});
