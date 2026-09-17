import '@emdash/ui/style.css';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderIdentityStrip } from '@core/features/integrations/contributions/browser/provider-identity-strip';
import type { Resolved } from '@core/primitives/project-settings/api';
import type { ProviderAccountSummary } from '@core/primitives/provider-accounts/api';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function account(
  accountId: string,
  displayName: string,
  isDefault = false
): ProviderAccountSummary {
  return {
    providerId: 'linear',
    displayName,
    accountId,
    displayDetail: 'Engineering',
    avatarUrl: '',
    credentialSource: 'cli',
    isDefault,
  };
}

const dkonopka = account('row-1', 'dkonopka', true);
const workBot = account('row-2', 'work-bot');

const presentation = {
  providerName: 'Linear',
  providerIcon: <span data-testid="provider-icon">L</span>,
  actionLabel: 'Acting as',
  emptyState: {
    connect: 'Connect a Linear account to continue.',
    unavailable: 'Choose a Linear account to continue.',
    noMatch: 'No connected account matches this workspace.',
  },
};

function resolved(
  value: ProviderAccountSummary | null,
  provenance: Resolved<ProviderAccountSummary | null>['provenance']
): Resolved<ProviderAccountSummary | null> {
  return { value, provenance };
}

describe('ProviderIdentityStrip', () => {
  let host: HTMLDivElement;
  let root: Root;
  let style: HTMLStyleElement;

  beforeEach(() => {
    style = document.createElement('style');
    style.textContent = `
      @layer utilities {
        .flex { display: flex; }
        .flex-1 { flex: 1 1 0%; }
        .min-w-0 { min-width: 0; }
        .shrink-0 { flex-shrink: 0; }
        .items-center { align-items: center; }
        .gap-2 { gap: 0.5rem; }
        .h-4 { height: 1rem; }
        .w-4 { width: 1rem; }
        .px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
        .py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
        .text-sm { font-size: 0.875rem; }
        .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      }
    `;
    document.head.append(style);

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    style.remove();
  });

  function strip(): HTMLElement {
    const element = host.querySelector<HTMLElement>('[data-testid="provider-identity-strip"]');
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

  it('shows generic account display fields, the provider icon, and default status', async () => {
    await act(async () => {
      root.render(
        <ProviderIdentityStrip
          {...presentation}
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

    expect(strip().textContent).toContain('dkonopka');
    expect(strip().textContent).toContain('Engineering');
    expect(strip().querySelector('[data-testid="provider-icon"]')?.textContent).toBe('L');
    expect(strip().textContent?.match(/default/gi)).toHaveLength(1);
    expect(buttonByText(strip(), 'Change')).toBeDefined();
  });

  it('uses a concise action-agnostic label while preserving the account identity', async () => {
    host.style.width = '440px';
    await act(async () => {
      root.render(
        <ProviderIdentityStrip
          {...presentation}
          resolved={resolved(account('row-3', 'jschwxrz', true), {
            kind: 'inferred',
            from: 'default account',
          })}
          accounts={[account('row-3', 'jschwxrz', true)]}
          override={null}
          persistence="action-only"
          accountRequired
          onSelect={vi.fn()}
          onConnect={vi.fn()}
        />
      );
    });

    const login = [...strip().querySelectorAll('span')].find(
      (element) => element.textContent === 'jschwxrz'
    );

    expect(strip().textContent).toContain('Acting as');
    expect(strip().textContent).not.toContain('Creating repository as');
    expect(strip().textContent?.match(/default/gi)).toHaveLength(1);
    expect(login?.getAttribute('title')).toBe('jschwxrz');
    expect(login!.scrollWidth).toBeLessThanOrEqual(login!.clientWidth);
    expect(strip().scrollWidth).toBeLessThanOrEqual(strip().clientWidth);
  });

  it('selects an account for this action from the popover, without remembering by default', async () => {
    const onSelect = vi.fn();
    await act(async () => {
      root.render(
        <ProviderIdentityStrip
          {...presentation}
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
    await act(async () => buttonByText(popup, 'work-bot').click());

    expect(onSelect).toHaveBeenCalledWith(workBot, { remember: false });
  });

  it('remembers for the project when the checkbox is checked before selecting', async () => {
    const onSelect = vi.fn();
    await act(async () => {
      root.render(
        <ProviderIdentityStrip
          {...presentation}
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
    await act(async () => buttonByText(popup, 'work-bot').click());

    expect(onSelect).toHaveBeenCalledWith(workBot, { remember: true });
  });

  it('always persists in project mode and says so instead of a checkbox', async () => {
    const onSelect = vi.fn();
    await act(async () => {
      root.render(
        <ProviderIdentityStrip
          {...presentation}
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
    await act(async () => buttonByText(popup, 'work-bot').click());

    expect(onSelect).toHaveBeenCalledWith(workBot, { remember: true });
  });

  it('shows a per-action override as the acting identity', async () => {
    await act(async () => {
      root.render(
        <ProviderIdentityStrip
          {...presentation}
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

    expect(strip().textContent).toContain('work-bot');
    expect(strip().textContent).not.toContain('(default)');
  });

  it('fails closed inline on an unresolvable pin with change-account as the fix', async () => {
    const onSelect = vi.fn();
    await act(async () => {
      root.render(
        <ProviderIdentityStrip
          {...presentation}
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

    expect(strip().textContent).toContain('The selected Linear account is no longer connected.');
    expect(strip().textContent).toContain('Choose a Linear account to continue.');

    const popup = await openPopover('Pick account');
    await act(async () => buttonByText(popup, 'dkonopka').click());
    expect(onSelect).toHaveBeenCalledWith(dkonopka, { remember: false });
  });

  it('renders the zero-account empty state with a blocking Connect for required actions', async () => {
    const onConnect = vi.fn();
    await act(async () => {
      root.render(
        <ProviderIdentityStrip
          {...presentation}
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

    expect(strip().textContent).toContain('No Linear account');
    expect(strip().textContent).toContain('Connect a Linear account to continue.');
    await act(async () => buttonByText(strip(), 'Connect').click());
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('uses the caller’s optional-account workflow description', async () => {
    await act(async () => {
      root.render(
        <ProviderIdentityStrip
          {...presentation}
          resolved={resolved(null, { kind: 'inferred', from: 'no host-matching account' })}
          accounts={[]}
          override={null}
          persistence="per-action"
          accountRequired={false}
          emptyState={{
            ...presentation.emptyState,
            connect: 'Continue without linking an issue.',
          }}
          onSelect={vi.fn()}
          onConnect={vi.fn()}
        />
      );
    });

    expect(strip().textContent).toContain('No Linear account');
    expect(strip().textContent).toContain('Continue without linking an issue.');
  });

  it('renders explicit none as quiet intent with the change affordance', async () => {
    await act(async () => {
      root.render(
        <ProviderIdentityStrip
          {...presentation}
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

    expect(strip().textContent).toContain('Linear is disabled for this project.');
    expect(buttonByText(strip(), 'Change')).toBeDefined();
  });

  it('uses the caller’s no-match explanation instead of repository-specific copy', async () => {
    await act(async () => {
      root.render(
        <ProviderIdentityStrip
          {...presentation}
          resolved={resolved(null, { kind: 'inferred', from: 'no host-matching account' })}
          accounts={[dkonopka]}
          override={null}
          persistence="action-only"
          accountRequired
          onSelect={vi.fn()}
          onConnect={vi.fn()}
        />
      );
    });

    expect(strip().textContent).toContain('No connected account matches this workspace.');
    expect(strip().textContent).not.toContain('repository');
  });

  it('disables selection and remembering when the operation becomes pending', async () => {
    const onSelect = vi.fn();
    const renderStrip = (disabled: boolean) => (
      <ProviderIdentityStrip
        {...presentation}
        resolved={resolved(dkonopka, { kind: 'inferred', from: 'default account' })}
        accounts={[dkonopka, workBot]}
        override={null}
        persistence="per-action"
        accountRequired
        disabled={disabled}
        onSelect={onSelect}
        onConnect={vi.fn()}
      />
    );
    await act(async () => root.render(renderStrip(false)));
    const popup = await openPopover();
    await act(async () => root.render(renderStrip(true)));

    expect(buttonByText(strip(), 'Change').disabled).toBe(true);
    const candidate = buttonByText(popup, 'work-bot');
    expect(candidate.disabled).toBe(true);
    await act(async () => candidate.click());
    expect(onSelect).not.toHaveBeenCalled();
    expect(
      popup.querySelector('[data-slot="checkbox"]')?.getAttribute('data-disabled')
    ).not.toBeNull();
  });
});
