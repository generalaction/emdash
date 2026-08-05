import type { AgentProviderId } from '@emdash/plugins/agents';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConversationPreferences } from './use-conversation-preferences';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Preferences = ReturnType<typeof useConversationPreferences>;
let latestPreferences: Preferences | undefined;
let secondaryPreferences: Preferences | undefined;

function Probe({
  secondary = false,
  providerId,
  autoApproveByDefault,
  modelOptions = {},
}: {
  secondary?: boolean;
  providerId: AgentProviderId;
  autoApproveByDefault: boolean;
  modelOptions?: Record<string, unknown>;
}) {
  const preferences = useConversationPreferences(providerId, autoApproveByDefault, modelOptions);
  if (secondary) secondaryPreferences = preferences;
  else latestPreferences = preferences;
  return null;
}

describe('useConversationPreferences', () => {
  let dom: JSDOM;
  let root: Root;
  let secondaryRoot: Root;
  let rootContainer: HTMLDivElement;
  let secondaryContainer: HTMLDivElement;

  beforeEach(() => {
    dom = new JSDOM('<div id="root"></div><div id="secondary"></div>', {
      url: 'http://localhost',
    });
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('localStorage', dom.window.localStorage);
    rootContainer = dom.window.document.getElementById('root') as HTMLDivElement;
    secondaryContainer = dom.window.document.getElementById('secondary') as HTMLDivElement;
    root = createRoot(rootContainer);
    secondaryRoot = createRoot(secondaryContainer);
    latestPreferences = undefined;
    secondaryPreferences = undefined;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
      secondaryRoot.unmount();
    });
    vi.unstubAllGlobals();
    dom.window.close();
  });

  async function render(autoApproveByDefault: boolean, modelOptions: Record<string, unknown> = {}) {
    await act(async () => {
      root.render(
        React.createElement(Probe, {
          providerId: 'claude',
          autoApproveByDefault,
          modelOptions,
        })
      );
    });
  }

  it('uses a task default that arrives after loading', async () => {
    await render(false);
    await render(true);

    expect(latestPreferences?.autoApprove).toBe(true);
  });

  it('ignores a persisted model that is no longer available', async () => {
    await render(false, { legacy: {} });
    await act(async () => latestPreferences?.setModel('legacy'));
    await render(false, { opus: {} });

    expect(latestPreferences?.model).toBeNull();
  });

  it('keeps model writes from independently mounted windows', async () => {
    await act(async () => {
      root.render(
        React.createElement(Probe, {
          providerId: 'claude',
          autoApproveByDefault: false,
          modelOptions: { opus: {} },
        })
      );
      secondaryRoot.render(
        React.createElement(Probe, {
          secondary: true,
          providerId: 'codex',
          autoApproveByDefault: false,
          modelOptions: { gpt: {} },
        })
      );
    });
    await act(async () => latestPreferences?.setModel('opus'));
    await act(async () => secondaryPreferences?.setModel('gpt'));
    await act(async () => {
      root.unmount();
      secondaryRoot.unmount();
    });
    root = createRoot(rootContainer);
    secondaryRoot = createRoot(secondaryContainer);
    await act(async () => {
      root.render(
        React.createElement(Probe, {
          providerId: 'claude',
          autoApproveByDefault: false,
          modelOptions: { opus: {} },
        })
      );
      secondaryRoot.render(
        React.createElement(Probe, {
          secondary: true,
          providerId: 'codex',
          autoApproveByDefault: false,
          modelOptions: { gpt: {} },
        })
      );
    });

    expect(latestPreferences?.model).toBe('opus');
    expect(secondaryPreferences?.model).toBe('gpt');
  });
});
