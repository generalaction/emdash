import '@emdash/ui/style.css';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { HostDependencyInstallation } from '@core/features/agents/api/browser/use-agent-installation-statuses';
import { InstallSection } from '@core/features/settings/contributions/browser/agents-page/InstallSection';

const hooks = vi.hoisted(() => ({ useAgentInstallationStatus: vi.fn() }));
vi.mock('@core/features/agents/api/browser/use-agent-installation-statuses', () => hooks);

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('installation override settings', () => {
  let host: HTMLDivElement;
  let root: Root;
  let vm: HostDependencyInstallation;

  beforeEach(() => {
    vm = {
      runtimeError: null,
      data: null,
      used: { kind: 'auto' },
      status: 'available',
      installations: [
        {
          id: '/bin/claude',
          realpath: '/bin/claude',
          pathEntry: '/bin/claude',
          isActive: true,
          manageable: false,
          provenance: { kind: 'unknown', confidence: 'inferred' },
          status: 'available',
          version: null,
          latestVersion: null,
          updateAvailable: false,
        },
      ],
      isInstalling: false,
      isUpdating: false,
      isUninstalling: false,
      installingMethod: undefined,
      updatingMethod: undefined,
      uninstallingMethod: undefined,
      installFailure: null,
      updateFailure: null,
      install: vi.fn(),
      update: vi.fn(),
      uninstall: vi.fn(),
      dismissInstallFailure: vi.fn(),
      dismissUpdateFailure: vi.fn(),
      refresh: vi.fn(),
      fetchLatestVersion: vi.fn(),
      setUsed: vi.fn(async () => {}),
      resolve: vi.fn(async () => ({
        id: 'claude',
        command: '/custom/wrapper',
        path: '/custom/wrapper',
        realpath: '/custom/wrapper',
        source: { kind: 'path' as const, path: '/custom/wrapper' },
      })),
    };
    hooks.useAgentInstallationStatus.mockReturnValue(vm);
    host = document.createElement('div');
    host.style.width = '480px';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  async function render() {
    await act(async () =>
      root.render(<InstallSection agentId="claude" agentPayload={undefined} installOptions={[]} />)
    );
  }

  async function choosePathOverride() {
    await page.getByRole('button', { name: 'Installation options' }).click();
    await page.getByRole('menuitem', { name: 'Change source' }).click();
    await page.getByRole('menuitem', { name: /^Path Override/ }).click();
  }

  it('keeps a new override as a draft until validation succeeds', async () => {
    vi.mocked(vm.setUsed).mockImplementation(async (selection) => {
      if (selection?.kind !== 'path') throw new Error('Expected a path');
      vm.used = selection;
      vm.installations.push({
        id: 'path',
        realpath: selection.path,
        pathEntry: selection.path,
        isActive: true,
        manageable: false,
        provenance: { kind: 'manual', confidence: 'confirmed' },
        status: 'available',
        version: null,
        latestVersion: null,
        updateAvailable: false,
      });
    });
    await render();
    await choosePathOverride();
    expect(vm.setUsed).not.toHaveBeenCalled();
    await page.getByRole('textbox', { name: 'Executable path' }).fill('/custom/wrapper');
    // A background status render must not discard the draft.
    vm.used = { kind: 'auto' };
    await render();
    await expect
      .element(page.getByRole('textbox', { name: 'Executable path' }))
      .toHaveValue('/custom/wrapper');
    await page.getByRole('button', { name: 'Validate' }).click();
    await expect
      .poll(() => vi.mocked(vm.setUsed).mock.calls)
      .toEqual([[{ kind: 'path', path: '/custom/wrapper' }]]);
    expect(vm.resolve).toHaveBeenCalledWith({ kind: 'path', path: '/custom/wrapper' });
    await expect.element(page.getByText('Found', { exact: true })).toBeVisible();
    await expect
      .element(page.getByRole('textbox', { name: 'Executable path' }))
      .toHaveValue('/custom/wrapper');
  });

  it('shows validation failures and leaves the active selection untouched', async () => {
    vi.mocked(vm.resolve).mockRejectedValue({
      type: 'invalid-selection',
      message: 'File is not executable',
    });
    await render();
    await choosePathOverride();
    await page.getByRole('textbox', { name: 'Executable path' }).fill('/bad/wrapper');
    await page.getByRole('button', { name: 'Validate' }).click();
    await expect.element(page.getByText('File is not executable')).toBeVisible();
    expect(vm.setUsed).not.toHaveBeenCalled();
  });

  it('restores saved values and displays save failures', async () => {
    vm.used = { kind: 'cli', command: 'sandbox-claude' };
    vi.mocked(vm.setUsed).mockRejectedValue({ type: 'io', message: 'disk full' });
    await render();
    await expect
      .element(page.getByRole('textbox', { name: 'Command name' }))
      .toHaveValue('sandbox-claude');
    await page.getByRole('button', { name: 'Validate' }).click();
    await expect.element(page.getByText('disk full')).toBeVisible();
    expect(vm.resolve).toHaveBeenCalledWith({ kind: 'cli', command: 'sandbox-claude' });
    expect(vm.setUsed).toHaveBeenCalledWith({ kind: 'cli', command: 'sandbox-claude' });
  });
});
