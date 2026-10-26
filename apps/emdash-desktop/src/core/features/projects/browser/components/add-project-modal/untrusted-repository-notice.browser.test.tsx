import '@emdash/ui/style.css';
import { err, ok, type Result } from '@emdash/shared';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import {
  UntrustedRepositoryNotice,
  type TrustRepositoryConfirmation,
} from './untrusted-repository-notice';

const wslRepository = {
  repositoryPath: '//wsl.localhost/Ubuntu/home/me/my repo',
  safeDirectory: '%(prefix)///wsl.localhost/Ubuntu/home/me/my repo',
};
const wslCommand =
  'git config --global --add safe.directory "%(prefix)///wsl.localhost/Ubuntu/home/me/my repo"';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('UntrustedRepositoryNotice', () => {
  let container: HTMLDivElement;
  let root: Root;
  let dialog: Root | undefined;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
      dialog?.unmount();
    });
    dialog = undefined;
    document.body.replaceChildren();
  });

  /** Stands in for the confirm modal: renders its content and answers with `answer`. */
  function confirmWith(answer: Promise<boolean>) {
    return vi.fn(async (confirmation: TrustRepositoryConfirmation) => {
      const host = document.createElement('div');
      document.body.append(host);
      dialog = createRoot(host);
      // Runs inside the click's act scope, which flushes this render.
      dialog.render(
        <section aria-label={confirmation.title}>{confirmation.description as ReactNode}</section>
      );
      return answer;
    });
  }

  async function clickButton(name: string) {
    const button = page.getByRole('button', { name }).element() as HTMLButtonElement;
    await act(async () => button.click());
  }

  function render(props: Partial<Parameters<typeof UntrustedRepositoryNotice>[0]> = {}) {
    const trust = vi.fn(async () => ok({ added: true }));
    const onTrusted = vi.fn(async () => {});
    const confirm = confirmWith(Promise.resolve(true));
    const all = { trust, onTrusted, confirm, ...props };
    act(() =>
      root.render(
        <UntrustedRepositoryNotice
          dubiousOwnership={wslRepository}
          hostLabel="this computer"
          {...all}
        />
      )
    );
    return all;
  }

  it('explains the refusal and shows the exact command Git suggests', async () => {
    render();

    await expect.element(page.getByText("Git doesn't trust this repository")).toBeVisible();
    await expect
      .element(page.getByText(wslRepository.repositoryPath, { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText(/WSL, on network shares, or on external drives/))
      .toBeVisible();
    await expect.element(page.getByText(wslCommand, { exact: true })).toBeVisible();
  });

  it('names PowerShell when only PowerShell keeps the value intact', async () => {
    render({
      dubiousOwnership: {
        repositoryPath: 'C:/Users/me/$work',
        safeDirectory: 'C:/Users/me/$work',
      },
    });

    await expect.element(page.getByText(/To trust it, run this in PowerShell:/)).toBeVisible();
    await expect
      .element(
        page.getByText("git config --global --add safe.directory 'C:/Users/me/$work'", {
          exact: true,
        })
      )
      .toBeVisible();
  });

  it('asks for confirmation that names the global Git config before trusting', async () => {
    const confirm = confirmWith(Promise.resolve(true));
    const { trust, onTrusted } = render({ confirm });

    await clickButton('Trust repository...');

    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0]).toMatchObject({
      title: 'Trust this repository?',
      confirmLabel: 'Trust repository',
    });
    const confirmation = page.getByRole('region', { name: 'Trust this repository?' });
    await expect.element(confirmation.getByText(/this computer/)).toBeVisible();
    await expect.element(confirmation.getByText(/changes your global Git config/)).toBeVisible();
    await expect.element(confirmation.getByText(wslCommand, { exact: true })).toBeVisible();
    await vi.waitFor(() => expect(trust).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(onTrusted).toHaveBeenCalledOnce());
  });

  it('writes nothing when the user cancels', async () => {
    const { trust, onTrusted } = render({ confirm: confirmWith(Promise.resolve(false)) });

    await clickButton('Trust repository...');

    await expect
      .element(page.getByRole('region', { name: 'Trust this repository?' }))
      .toBeVisible();
    expect(trust).not.toHaveBeenCalled();
    expect(onTrusted).not.toHaveBeenCalled();
    await expect.element(page.getByRole('button', { name: 'Trust repository...' })).toBeEnabled();
  });

  it('shows why trusting failed and lets the user try again', async () => {
    const trust = vi
      .fn()
      .mockResolvedValueOnce(
        err({ message: 'The Emdash workspace server on this machine is too old.' })
      )
      .mockResolvedValueOnce(ok({ added: true }));
    const { onTrusted } = render({ trust, hostLabel: 'build-box' });

    await clickButton('Trust repository...');
    await expect
      .element(page.getByText('The Emdash workspace server on this machine is too old.'))
      .toBeVisible();
    expect(onTrusted).not.toHaveBeenCalled();

    await clickButton('Trust repository...');
    await vi.waitFor(() => expect(onTrusted).toHaveBeenCalledOnce());
    expect(trust).toHaveBeenCalledTimes(2);
  });

  it('disables the button while the trust request runs', async () => {
    let finish!: () => void;
    const trust = vi.fn(
      () =>
        new Promise<Result<{ added: boolean }, { message: string }>>((resolve) => {
          finish = () => resolve(ok({ added: true }));
        })
    );
    render({ trust });

    await clickButton('Trust repository...');
    await expect.element(page.getByRole('button', { name: 'Trusting...' })).toBeDisabled();
    await act(async () => finish());
    await expect.element(page.getByRole('button', { name: 'Trust repository...' })).toBeEnabled();
  });
});
