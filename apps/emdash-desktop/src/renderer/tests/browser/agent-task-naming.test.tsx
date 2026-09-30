import '@emdash/ui/style.css';
import '@emdash/theme/theme.css';
import { ChatComposer, PromptEditorModel } from '@emdash/ui/react/components';
import { defineContract } from '@emdash/wire/rpc';
import { createTestWire } from '@emdash/wire/testing';
import { QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import {
  isTaskNamingCommand,
  withTaskNamingCommands,
} from '@core/features/conversations/api/browser/chat/task-naming-commands';
import { AutoNameWithAgentRow } from '@core/features/settings/browser/components/TaskSettingsRows';
import { useTaskName } from '@core/features/tasks/api/browser/create-task-modal/use-task-name';
import { TaskNameField } from '@core/features/tasks/browser/create-task-modal/task-name-field';
import { taskSettingsContribution } from '@core/features/tasks/contributions/settings';
import type { TaskSettings } from '@core/primitives/app-settings/api';
import { queryClient } from '@core/primitives/query/browser/query-client';
import { resetWireConnection, seedWireConnection } from '@core/primitives/wire/browser/connection';
import { appSettingsContract } from '@core/services/settings/api/contract';

const contract = defineContract({ appSettings: appSettingsContract });
const defaults =
  typeof taskSettingsContribution.defaults === 'function'
    ? taskSettingsContribution.defaults()
    : taskSettingsContribution.defaults;

function NameField() {
  const state = useTaskName({ generatedName: 'shaggy-canyons-appear' });
  return <TaskNameField state={state} autoNameWithAgent />;
}

describe('conversation AI task naming controls', () => {
  let root: Root;
  let host: HTMLDivElement;
  let settings: TaskSettings;
  let wire: Pick<ReturnType<typeof createTestWire>, 'connection' | 'dispose'>;

  beforeEach(async () => {
    await page.viewport(1000, 600);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    settings = { ...defaults };
    queryClient.clear();
    resetWireConnection();
    wire = createTestWire(
      contract,
      {
        appSettings: {
          get: () => settings,
          getAll: () => {
            throw new Error('Unexpected settings request');
          },
          getWithMeta: () => ({
            value: settings,
            defaults,
            overrides:
              settings.autoNameWithAgent === defaults.autoNameWithAgent
                ? {}
                : { autoNameWithAgent: settings.autoNameWithAgent },
          }),
          update: ({ value }) => {
            settings = taskSettingsContribution.schema.parse(value);
          },
          reset: () => {
            settings = { ...defaults };
          },
          resetField: ({ field }) => {
            if (field !== 'autoNameWithAgent') throw new Error('Unexpected settings field');
            settings = { ...settings, autoNameWithAgent: defaults.autoNameWithAgent };
          },
        },
      },
      { validate: 'full' }
    );
    seedWireConnection(async () => wire.connection);
    host = document.createElement('div');
    host.className = 'emlight';
    host.style.cssText = 'width:720px;padding:24px;font-family:system-ui;background:white;';
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    queryClient.clear();
    resetWireConnection();
    await wire.dispose();
  });

  it('persists the naming preference and resets it through the real Wire client', async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <h2>General — Task preferences</h2>
          <AutoNameWithAgentRow />
        </QueryClientProvider>
      );
    });
    const toggle = page.getByRole('switch', { name: 'Name tasks with conversation AI' });
    await expect.element(toggle).toBeEnabled();
    await expect.element(toggle).toBeChecked();
    const evidenceDir = import.meta.env.VITE_TASK_NAMING_SCREENSHOT_DIR;
    if (evidenceDir) {
      await page.screenshot({ element: host, path: `${evidenceDir}/settings-enabled.png` });
    }

    await act(async () => toggle.click());
    await vi.waitFor(() => expect(settings.autoNameWithAgent).toBe(false));
    await expect.element(toggle).not.toBeChecked();
    await expect.element(page.getByRole('button', { name: 'Reset to default' })).toBeEnabled();
    if (evidenceDir) {
      await page.screenshot({ element: host, path: `${evidenceDir}/settings-disabled.png` });
    }
    await act(async () => page.getByRole('button', { name: 'Reset to default' }).click());
    await expect.element(toggle).toBeChecked();
  });

  it('explains the naming behavior beside the generated placeholder accessibly', async () => {
    await act(async () => {
      root.render(
        <div>
          <h2>Create Task</h2>
          <NameField />
        </div>
      );
    });
    const input = page.getByRole('textbox', { name: 'Task name' });
    await expect.element(input).toHaveAttribute('placeholder', 'shaggy-canyons-appear');
    await expect
      .element(input)
      .toHaveAccessibleDescription(
        'Your first conversation’s AI will replace this placeholder with a short name of up to five words. If unsupported, the original name stays.'
      );
    const evidenceDir = import.meta.env.VITE_TASK_NAMING_SCREENSHOT_DIR;
    if (evidenceDir) {
      await page.screenshot({ element: host, path: `${evidenceDir}/create-task-placeholder.png` });
    }
  });

  it('offers and inserts the task naming slash command in the real chat composer', async () => {
    const model = new PromptEditorModel();
    host.style.minHeight = '360px';
    try {
      await act(async () => {
        root.render(
          <>
            <h2>Chat — Task naming</h2>
            <ChatComposer
              model={model}
              onSubmit={() => {}}
              queryCommands={async (query) =>
                withTaskNamingCommands([]).filter(({ name }) => name.includes(query.toLowerCase()))
              }
            />
          </>
        );
      });
      await act(async () => {
        await page.getByTestId('prompt-editor').click();
        await userEvent.keyboard('/ren');
      });
      const command = page.getByRole('option', { name: /^\/rename-task\b/ });
      await expect.element(command).toBeVisible();
      const evidenceDir = import.meta.env.VITE_TASK_NAMING_SCREENSHOT_DIR;
      if (evidenceDir) {
        await page.screenshot({ element: host, path: `${evidenceDir}/chat-rename-commands.png` });
      }
      await act(async () => command.click());
      expect(model.getText().trim()).toBe('/rename-task');
      expect(isTaskNamingCommand(model.getText(), [])).toBe(true);
    } finally {
      await act(async () => root.render(null));
      model.dispose();
    }
  });
});
