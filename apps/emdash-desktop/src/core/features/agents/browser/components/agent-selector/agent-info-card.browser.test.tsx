import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentInfoCard } from '@core/features/agents/browser/components/agent-selector/agent-info-card';

const mocks = vi.hoisted(() => ({
  installSection: vi.fn(() => null),
  payload: {
    id: 'grok',
    name: 'Grok',
    description: '',
    websiteUrl: '',
    status: 'missing',
    installDocs: 'https://example.com/install',
    installOptions: [],
  },
}));

vi.mock('@emdash/ui/react/primitives', async () => {
  const { createElement } = await import('react');
  return {
    Button: ({ children }: { children?: React.ReactNode }) =>
      createElement('button', null, children),
    Switch: () => null,
  };
});

vi.mock('@core/features/agents/api/browser/client', () => ({
  hostRefFromConnectionId: () => ({ kind: 'local' }),
}));

vi.mock('@core/features/agents/api/browser/use-agent-installation-statuses', () => ({
  useAgentInstallationStatus: () => ({ data: null, status: 'missing' }),
}));

vi.mock('@core/features/agents/api/browser/use-agents', () => ({
  useAgent: () => ({ data: mocks.payload }),
}));

vi.mock('@core/features/agents/contributions/browser/agent-icon', () => ({
  AgentIcon: () => null,
}));

vi.mock('@core/features/settings/api/browser/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({
    value: 'claude',
    update: vi.fn(),
    isLoading: false,
    isSaving: false,
  }),
}));

vi.mock('@core/features/settings/contributions/browser/agents-page/InstallSection', () => ({
  InstallSection: mocks.installSection,
}));

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('AgentInfoCard', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.installSection.mockClear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('passes the documentation URL to the compact installation section', async () => {
    await act(async () => {
      root.render(<AgentInfoCard id="grok" />);
    });

    expect(mocks.installSection).toHaveBeenCalledWith(
      expect.objectContaining({
        agentPayload: mocks.payload,
        installDocs: 'https://example.com/install',
        compact: true,
      }),
      undefined
    );
  });
});
