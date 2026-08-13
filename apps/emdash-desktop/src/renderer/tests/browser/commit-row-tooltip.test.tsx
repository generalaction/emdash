import '@emdash/ui/style.css';
import type { Commit } from '@emdash/core/runtimes/git/api';
import { Tooltip } from '@emdash/ui/react/primitives';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { CommitRowButton } from '@core/features/source-control/browser/diff-view/changes-panel/components/pr-entry/commit-row-button';
import { ThemeProvider } from '@core/primitives/theme/browser/theme-provider';

const commit: Commit = {
  hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
  parents: ['0123456789abcdef0123456789abcdef01234567'],
  subject:
    'feat(source-control): a deliberately long commit subject that cannot fit inside a narrow panel',
  body: '',
  author: 'Ada Lovelace',
  authorEmail: 'ada@example.com',
  date: Date.UTC(2026, 0, 15, 12, 30),
  committer: 'Ada Lovelace',
  committerEmail: 'ada@example.com',
  committerDate: Date.UTC(2026, 0, 15, 12, 30),
  isPushed: false,
  tags: [],
};

beforeAll(() => {
  // The browser-test harness compiles no app-level Tailwind (vitest.config.ts
  // has no @tailwindcss/vite plugin), so the layout utilities that produce
  // real truncation geometry are shimmed here; without them the subject would
  // wrap instead of overflowing and scrollWidth would never exceed clientWidth.
  const style = document.createElement('style');
  style.textContent = [
    '.flex{display:flex}',
    '.block{display:block}',
    '.w-full{width:100%}',
    '.min-w-0{min-width:0}',
    '.flex-1{flex:1 1 0%}',
    '.truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  ].join('');
  document.head.appendChild(style);
});

describe('commit row tooltip', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    root.unmount();
    host.remove();
  });

  async function renderRow(width: number) {
    host.style.width = `${width}px`;
    root.render(
      <ThemeProvider theme="emlight" onThemeChange={vi.fn()}>
        <Tooltip.Provider delay={0} closeDelay={0}>
          <CommitRowButton commit={commit} isExpanded={false} onToggleExpanded={vi.fn()} />
        </Tooltip.Provider>
      </ThemeProvider>
    );
    return await vi.waitFor(() => {
      const trigger = host.querySelector('button');
      expect(trigger).not.toBeNull();
      return trigger!;
    });
  }

  it('shows the full subject on hover when the subject is truncated', async () => {
    const trigger = await renderRow(200);
    const subjectEl = trigger.querySelector('span > span')!;
    expect(subjectEl.scrollWidth).toBeGreaterThan(subjectEl.clientWidth);

    await userEvent.hover(trigger);
    await vi.waitFor(() => {
      const content = document.querySelector('[data-slot="tooltip-content"]');
      expect(content?.textContent).toContain(commit.subject);
    });

    await userEvent.unhover(trigger);
    await vi.waitFor(() => {
      expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();
    });
  });

  it('does not show a tooltip when the subject fits', async () => {
    const trigger = await renderRow(900);
    const subjectEl = trigger.querySelector('span > span')!;
    expect(subjectEl.scrollWidth).toBeLessThanOrEqual(subjectEl.clientWidth);

    await userEvent.hover(trigger);
    // Give an incorrectly gated tooltip ample time to appear before asserting.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();
    await userEvent.unhover(trigger);
  });
});
