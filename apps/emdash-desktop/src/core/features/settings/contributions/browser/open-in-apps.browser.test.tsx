import '@emdash/ui/style.css';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { UseOpenInAppsResult } from '@core/features/settings/api/browser/useOpenInApps';
import HiddenToolsSettingsCard from '@core/features/settings/browser/components/HiddenToolsSettingsCard';
import { OPEN_IN_APPS } from '@core/primitives/open-in-apps/api/open-in-apps';
import { OpenInMenu } from './open-in-menu';

const mocks = vi.hoisted(() => ({
  apps: {} as UseOpenInAppsResult,
  refresh: vi.fn(),
  openIn: vi.fn(async () => ({ success: true })),
}));

vi.mock('@core/features/settings/api/browser/useOpenInApps', () => ({
  useOpenInApps: () => mocks.apps,
}));
vi.mock('@core/features/settings/api/browser/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({
    value: { default: 'zed', hidden: [] },
    update: vi.fn(),
    isLoading: false,
    isSaving: false,
  }),
}));
vi.mock('@core/primitives/theme/browser', () => ({
  useTheme: () => ({ effectiveTheme: 'emlight' }),
}));
vi.mock('@core/primitives/keybindings/browser/shortcut', () => ({ BoundShortcut: () => null }));
vi.mock('@core/primitives/desktop-host/browser/host-client', () => ({
  getHostClient: async () => ({ openIn: mocks.openIn }),
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.apps = {
    availability: Object.fromEntries(Object.keys(OPEN_IN_APPS).map((id) => [id, 'not-detected'])),
    icons: {},
    labels: {},
    installedApps: [OPEN_IN_APPS.finder, OPEN_IN_APPS.zed, OPEN_IN_APPS.vscode],
    platform: 'darwin',
    loading: false,
    refreshing: false,
    hasDetectionProblem: true,
    refresh: mocks.refresh,
  };
  Object.assign(mocks.apps.availability, {
    finder: 'detected',
    zed: 'unknown',
    vscode: 'checking',
  });
  host = document.createElement('div');
  host.style.width = '600px';
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it('shows uncertainty separately from absence and allows a retry in settings', async () => {
  await act(async () => root.render(<HiddenToolsSettingsCard />));
  await expect.element(page.getByText('Couldn’t check', { exact: true })).toBeVisible();
  await expect.element(page.getByRole('switch', { name: 'Show Zed in open menu' })).toBeDisabled();
  await expect
    .element(page.getByRole('switch', { name: 'Hide Finder in open menu' }))
    .toBeEnabled();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  expect(mocks.refresh).toHaveBeenCalledOnce();
  mocks.apps.refreshing = true;
  await act(async () => root.render(<HiddenToolsSettingsCard />));
  await expect.element(page.getByRole('button', { name: 'Retry', exact: true })).toBeDisabled();
  expect(host.textContent).not.toContain('Checking');
});

it('shows one loading status while checking apps in settings', async () => {
  mocks.apps.availability.zed = 'checking';
  mocks.apps.hasDetectionProblem = false;
  mocks.apps.refreshing = true;
  await act(async () => root.render(<HiddenToolsSettingsCard />));
  await expect.element(page.getByRole('status')).toHaveTextContent('Checking applications…');
  expect(host.textContent?.match(/Checking/g)).toHaveLength(1);
  expect(page.getByRole('button', { name: 'Retry', exact: true }).elements()).toHaveLength(0);
  await expect.element(page.getByRole('switch', { name: 'Show Zed in open menu' })).toBeDisabled();
});

it('keeps Finder usable and omits unknown or pending apps from the real dropdown', async () => {
  mocks.apps.labels = { finder: 'Finder', zed: 'Zed', vscode: 'VS Code' };
  await act(async () => root.render(<OpenInMenu path="/test/project" />));
  await page.getByRole('button', { name: 'Open in Finder', exact: true }).click();
  expect(mocks.openIn).toHaveBeenCalledWith(
    expect.objectContaining({ app: 'finder', path: '/test/project' })
  );
  await page.getByRole('button', { name: 'Open in options', exact: true }).click();
  await expect
    .element(page.getByRole('menuitemradio', { name: 'Finder', exact: true }))
    .toBeEnabled();
  expect(page.getByRole('menuitemradio').elements()).toHaveLength(1);
  expect(page.getByRole('menu').element().textContent).toBe('Finder');
  expect(mocks.refresh).not.toHaveBeenCalled();
});
