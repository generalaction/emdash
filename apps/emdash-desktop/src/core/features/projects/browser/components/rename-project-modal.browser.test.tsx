import { Dialog } from '@emdash/ui/react/primitives';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RenameProjectModal } from './rename-project-modal';

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  dismiss: vi.fn(),
  renameProject: vi.fn(),
}));

vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  getProjectManagerStore: () => ({
    renameProject: mocks.renameProject,
  }),
}));

vi.mock('@core/manifests/browser/modal-api', () => ({
  useModalController: () => ({
    complete: mocks.complete,
    dismiss: mocks.dismiss,
  }),
}));

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function pressEnter(input: HTMLInputElement): void {
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

describe('RenameProjectModal', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.complete.mockReset();
    mocks.dismiss.mockReset();
    mocks.renameProject.mockReset();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  async function renderModal(): Promise<HTMLInputElement> {
    await act(async () => {
      root.render(
        <Dialog.Root open>
          <RenameProjectModal projectId="project-1" currentName="Emdash" />
        </Dialog.Root>
      );
    });
    const input = host.querySelector<HTMLInputElement>('input');
    if (!input) throw new Error('rename input not rendered');
    return input;
  }

  it('renames once and completes when Enter is pressed', async () => {
    mocks.renameProject.mockResolvedValue(undefined);
    const input = await renderModal();

    await act(async () => setInputValue(input, '  Emdash Desktop  '));
    await act(async () => pressEnter(input));

    expect(mocks.renameProject).toHaveBeenCalledTimes(1);
    expect(mocks.renameProject).toHaveBeenCalledWith('project-1', 'Emdash Desktop');
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });

  it('ignores repeated Enter while a rename is pending', async () => {
    let finish: () => void = () => {};
    mocks.renameProject.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const input = await renderModal();

    await act(async () => setInputValue(input, 'Emdash Desktop'));
    await act(async () => pressEnter(input));
    await act(async () => pressEnter(input));
    await act(async () => pressEnter(input));

    expect(mocks.renameProject).toHaveBeenCalledTimes(1);
    expect(mocks.complete).not.toHaveBeenCalled();

    await act(async () => finish());
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });

  it('does not submit an empty or unchanged name', async () => {
    const input = await renderModal();

    await act(async () => pressEnter(input));
    await act(async () => setInputValue(input, '   '));
    await act(async () => pressEnter(input));

    expect(mocks.renameProject).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Project name cannot be empty.');
  });

  it('shows the failure and re-enables submission', async () => {
    mocks.renameProject.mockRejectedValueOnce(new Error('Project missing not found'));
    mocks.renameProject.mockResolvedValueOnce(undefined);
    const input = await renderModal();

    await act(async () => setInputValue(input, 'Emdash Desktop'));
    await act(async () => pressEnter(input));
    expect(host.textContent).toContain('Project missing not found');
    expect(mocks.complete).not.toHaveBeenCalled();

    await act(async () => pressEnter(input));
    expect(mocks.renameProject).toHaveBeenCalledTimes(2);
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });
});
