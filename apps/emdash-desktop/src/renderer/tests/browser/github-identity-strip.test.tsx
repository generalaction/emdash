import '@emdash/ui/style.css';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubIdentityStrip } from '@core/features/github/contributions/browser/identity-strip';
import type { GitHubAccountSummary } from '@core/primitives/github/api';
import type { Resolved } from '@core/primitives/project-settings/api';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function account(accountId: string, login: string, isDefault = false): GitHubAccountSummary {
  return {
    accountId,
    host: 'github.com',
    login,
    avatarUrl: '',
    credentialSource: 'cli',
    isDefault,
  };
}

const dkonopka = account('row-1', 'dkonopka', true);
const workBot = account('row-2', 'work-bot');

function resolved(
  value: GitHubAccountSummary | null,
  provenance: Resolved<GitHubAccountSummary | null>['provenance']
): Resolved<GitHubAccountSummary | null> {
  return { value, provenance };
}

describe('GitHubIdentityStrip (Variant A, spec §9)', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  function strip(): HTMLElement {
    const element = host.querySelector<HTMLElement>('[data-testid="github-identity-strip"]');
    if (!element) throw new Error('identity strip not rendered');
    return element;
  }

  function buttonByText(scope: ParentNode, text: string): HTMLButtonElement {
    const button = [...scope.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.includes(text)
    );
    if (!button) throw new Error(`no button containing "${text}"`);
    return button;
  }

  async function openPopover(label = 'Change'): Promise<HTMLElement> {
    await act(async () => buttonByText(strip(), label).click());
    const popup = document.querySelector<HTMLElement>('[data-slot="popover-content"]');
    if (!popup) throw new Error('popover did not open');
    return popup;
  }

  it('ambiently shows the action, account, host, and inference hint', async () => {
    await act(async () => {
      root.render(
        <GitHubIdentityStrip
          action="Creating PR"
          resolved={resolved(dkonopka, { kind: 'inferred', from: 'default account' })}
          accounts={[dkonopka, workBot]}
          override={null}
          persistence="per-action"
          accountRequired
          onSelect={vi.fn()}
          onConnect={vi.fn()}
        />
      );
    });

    expect(strip().textContent).toContain('Creating PR as');
    expect(strip().textContent).toContain('@dkonopka');
    expect(strip().textContent).toContain('github.com');
    expect(strip().textContent).toContain('(default)');
    expect(buttonByText(strip(), 'Change')).toBeDefined();
  });

  it('selects an account for this action from the popover, without remembering by default', async () => {
    const onSelect = vi.fn();
    await act(async () => {
      root.render(
        <GitHubIdentityStrip
          action="Creating repository"
          resolved={resolved(dkonopka, { kind: 'inferred', from: 'default account' })}
          accounts={[dkonopka, workBot]}
          override={null}
          persistence="per-action"
          accountRequired
          onSelect={onSelect}
          onConnect={vi.fn()}
        />
      );
    });

    const popup = await openPopover();
    expect(popup.textContent).toContain('Remember for this project');
    await act(async () => buttonByText(popup, '@work-bot').click());

    expect(onSelect).toHaveBeenCalledWith(workBot, { remember: false });
  });

  it('remembers for the project when the checkbox is checked before selecting', async () => {
    const onSelect = vi.fn();
    await act(async () => {
      root.render(
        <GitHubIdentityStrip
          action="Creating repository"
          resolved={resolved(dkonopka, { kind: 'inferred', from: 'default account' })}
          accounts={[dkonopka, workBot]}
          override={null}
          persistence="per-action"
          accountRequired
          onSelect={onSelect}
          onConnect={vi.fn()}
        />
      );
    });

    const popup = await openPopover();
    const checkbox = popup.querySelector<HTMLElement>('[data-slot="checkbox"]');
    if (!checkbox) throw new Error('remember checkbox not rendered');
    await act(async () => checkbox.click());
    await act(async () => buttonByText(popup, '@work-bot').click());

    expect(onSelect).toHaveBeenCalledWith(workBot, { remember: true });
  });

  it('always persists in project mode and says so instead of a checkbox', async () => {
    const onSelect = vi.fn();
    await act(async () => {
      root.render(
        <GitHubIdentityStrip
          action="Creating PR"
          resolved={resolved(dkonopka, { kind: 'inferred', from: 'default account' })}
          accounts={[dkonopka, workBot]}
          override={null}
          persistence="project"
          accountRequired
          onSelect={onSelect}
          onConnect={vi.fn()}
        />
      );
    });

    const popup = await openPopover();
    expect(popup.textContent).toContain('Selections apply to this project.');
    expect(popup.querySelector('[data-slot="checkbox"]')).toBeNull();
    await act(async () => buttonByText(popup, '@work-bot').click());

    expect(onSelect).toHaveBeenCalledWith(workBot, { remember: true });
  });

  it('shows a per-action override as the acting identity', async () => {
    await act(async () => {
      root.render(
        <GitHubIdentityStrip
          action="Adding remote"
          resolved={resolved(dkonopka, { kind: 'inferred', from: 'default account' })}
          accounts={[dkonopka, workBot]}
          override={workBot}
          persistence="per-action"
          accountRequired={false}
          onSelect={vi.fn()}
          onConnect={vi.fn()}
        />
      );
    });

    expect(strip().textContent).toContain('@work-bot');
    expect(strip().textContent).not.toContain('(default)');
  });

  it('fails closed inline on an unresolvable pin with change-account as the fix', async () => {
    const onSelect = vi.fn();
    await act(async () => {
      root.render(
        <GitHubIdentityStrip
          action="Creating PR"
          resolved={resolved(null, { kind: 'unresolvable' })}
          accounts={[dkonopka, workBot]}
          override={null}
          persistence="per-action"
          accountRequired
          onSelect={onSelect}
          onConnect={vi.fn()}
        />
      );
    });

    expect(strip().textContent).toContain('The selected GitHub account is no longer connected.');
    expect(strip().textContent).toContain('Creating PR is blocked until you pick an account.');

    const popup = await openPopover('Pick account');
    await act(async () => buttonByText(popup, '@dkonopka').click());
    expect(onSelect).toHaveBeenCalledWith(dkonopka, { remember: false });
  });

  it('renders the zero-account empty state with a blocking Connect for required actions', async () => {
    const onConnect = vi.fn();
    await act(async () => {
      root.render(
        <GitHubIdentityStrip
          action="Creating PR"
          resolved={resolved(null, { kind: 'inferred', from: 'no host-matching account' })}
          accounts={[]}
          override={null}
          persistence="project"
          accountRequired
          onSelect={vi.fn()}
          onConnect={onConnect}
        />
      );
    });

    expect(strip().textContent).toContain('No GitHub account');
    expect(strip().textContent).toContain('Connect a GitHub account to continue.');
    await act(async () => buttonByText(strip(), 'Connect').click());
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('renders the zero-account quiet state for actions that degrade to system credentials', async () => {
    await act(async () => {
      root.render(
        <GitHubIdentityStrip
          action="Adding remote"
          resolved={resolved(null, { kind: 'inferred', from: 'no host-matching account' })}
          accounts={[]}
          override={null}
          persistence="per-action"
          accountRequired={false}
          onSelect={vi.fn()}
          onConnect={vi.fn()}
        />
      );
    });

    expect(strip().textContent).toContain('No GitHub account');
    expect(strip().textContent).toContain('Git operations will use your system credentials.');
  });

  it('renders explicit none as quiet intent with the change affordance', async () => {
    await act(async () => {
      root.render(
        <GitHubIdentityStrip
          action="Creating PR"
          resolved={resolved(null, { kind: 'set' })}
          accounts={[dkonopka]}
          override={null}
          persistence="project"
          accountRequired
          onSelect={vi.fn()}
          onConnect={vi.fn()}
        />
      );
    });

    expect(strip().textContent).toContain('GitHub is disabled for this project.');
    expect(buttonByText(strip(), 'Change')).toBeDefined();
  });
});
