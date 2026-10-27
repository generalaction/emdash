import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentDetailSheet } from '@core/features/settings/browser/agents-page/AgentDetailSheet';

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
  const Container = ({ children }: { children?: React.ReactNode }) =>
    createElement('div', null, children);

  return {
    Field: { Root: Container },
    Label: Container,
    MicroLabel: Container,
    Sheet: { Root: Container, Content: Container, Header: Container },
  };
});

vi.mock('@core/features/agents/api/browser/client', () => ({
  hostRefFromConnectionId: () => ({ kind: 'local' }),
}));

vi.mock('@core/features/agents/api/browser/use-agent-settings', () => ({
  useAgentSettings: () => ({
    value: {},
    isOverridden: false,
    isLoading: false,
    update: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock('@core/features/agents/api/browser/use-agents', () => ({
  useAgents: () => ({ data: [mocks.payload] }),
}));

vi.mock('@core/features/settings/browser/agents-page/AgentIntegrationSection', () => ({
  AgentHooksSection: () => null,
  AgentTrustSection: () => null,
}));

vi.mock('@core/features/settings/browser/agents-page/AgentMcpSection', () => ({
  AgentMcpSection: () => null,
  useManageMcpSettingsNavigation: () => vi.fn(),
}));

vi.mock('@core/features/settings/browser/agents-page/AgentSheetHeaderSection', () => ({
  AgentSheetHeaderSection: () => null,
}));

vi.mock('@core/features/settings/browser/agents-page/InstalledAgentContent', () => ({
  InstalledAgentContent: () => null,
}));

vi.mock('@core/features/settings/contributions/browser/agents-page/InstallSection', () => ({
  InstallSection: mocks.installSection,
}));

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('agent installation documentation', () => {
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

  it('passes the documentation URL from the settings sheet', async () => {
    await act(async () => {
      root.render(<AgentDetailSheet agentId="grok" onClose={vi.fn()} />);
    });

    expect(mocks.installSection).toHaveBeenCalledWith(
      expect.objectContaining({
        agentPayload: mocks.payload,
        installDocs: 'https://example.com/install',
      }),
      undefined
    );
  });
});
