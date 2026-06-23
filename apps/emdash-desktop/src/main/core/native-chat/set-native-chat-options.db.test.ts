import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDb } from '@main/db/client';

const mocks = vi.hoisted(() => ({
  db: undefined as AppDb | undefined,
  emit: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  get db() {
    if (!mocks.db) throw new Error('Test database not initialized');
    return mocks.db;
  },
}));

vi.mock('@main/lib/events', () => ({ events: { emit: mocks.emit } }));

import { SettingsStore } from '@main/core/settings/settings-service';
import { setNativeChatOptions } from './set-native-chat-options';

describe('setNativeChatOptions provider defaults', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    fixture = await openFixture('empty');
    mocks.db = fixture.db;

    fixture.sqlite
      .prepare(
        `INSERT INTO projects (id, name, path, created_at, updated_at)
         VALUES ('project-1', 'Project', '/repo', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
      .run();
    fixture.sqlite
      .prepare(
        `INSERT INTO tasks (id, project_id, name, status, created_at, updated_at, status_changed_at)
         VALUES ('task-1', 'project-1', 'Task', 'in_progress', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
      .run();
    fixture.sqlite
      .prepare(
        `INSERT INTO conversations (id, project_id, task_id, title, provider, config, created_at, updated_at)
         VALUES ('conv-1', 'project-1', 'task-1', 'Codex (1)', 'codex', '{"uiMode":"native-chat"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
      .run();
  });

  afterEach(() => {
    fixture.close();
    mocks.db = undefined;
  });

  it('saves model, reasoning, and speed as the provider defaults', async () => {
    await setNativeChatOptions('project-1', 'task-1', 'conv-1', {
      model: 'gpt-5.4-mini',
      reasoningEffort: 'xhigh',
      serviceTier: 'priority',
    });

    await expect(new SettingsStore().get('nativeChatDefaults')).resolves.toEqual({
      codex: { model: 'gpt-5.4-mini', reasoningEffort: 'xhigh', serviceTier: 'priority' },
    });
  });

  it('clearing an option back to Default clears the saved default too', async () => {
    await setNativeChatOptions('project-1', 'task-1', 'conv-1', {
      model: 'gpt-5.4-mini',
      reasoningEffort: 'high',
    });
    await setNativeChatOptions('project-1', 'task-1', 'conv-1', { model: null });

    await expect(new SettingsStore().get('nativeChatDefaults')).resolves.toEqual({
      codex: { reasoningEffort: 'high' },
    });
  });

  it('autoApprove-only changes do not touch the saved defaults', async () => {
    await setNativeChatOptions('project-1', 'task-1', 'conv-1', { autoApprove: true });
    await expect(new SettingsStore().get('nativeChatDefaults')).resolves.toEqual({});
  });
});
