import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalRow } from '@main/db/schema';
import { createTerminal } from './createTerminal';

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  delete: vi.fn(),
  resolveTask: vi.fn(),
  getAppSetting: vi.fn(),
  captureTelemetry: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    insert: mocks.insert,
    delete: mocks.delete,
  },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: {
    capture: mocks.captureTelemetry,
  },
}));

vi.mock('../projects/utils', () => ({
  resolveTask: mocks.resolveTask,
}));

vi.mock('../settings/settings-service', () => ({
  appSettingsService: {
    get: mocks.getAppSetting,
  },
}));

function terminalRow(values: Partial<TerminalRow> = {}): TerminalRow {
  return {
    id: values.id ?? 'terminal-1',
    projectId: values.projectId ?? 'project-1',
    taskId: values.taskId ?? 'task-1',
    ssh: values.ssh ?? 0,
    name: values.name ?? 'Terminal 1',
    shellId: values.shellId ?? 'system',
    createdAt: values.createdAt ?? '2026-05-29 12:00:00',
    updatedAt: values.updatedAt ?? '2026-05-29 12:00:00',
  };
}

function mockInsert() {
  const returning = vi.fn();
  const values = vi.fn((row: Partial<TerminalRow>) => {
    returning.mockResolvedValue([terminalRow(row)]);
    return { returning };
  });
  mocks.insert.mockReturnValue({ values });
  return { values, returning };
}

function mockTask(kind: 'local' | 'ssh') {
  const spawnTerminal = vi.fn().mockResolvedValue(undefined);
  mocks.resolveTask.mockReturnValue({
    terminals: {
      kind,
      spawnTerminal,
    },
  });
  return { spawnTerminal };
}

function insertValuesMock() {
  return mocks.insert.mock.results[0]?.value.values as ReturnType<typeof vi.fn>;
}

describe('createTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert();
    mocks.getAppSetting.mockResolvedValue({ defaultShell: 'bash' });
  });

  it('uses the configured default shell for local terminals when no shell is specified', async () => {
    const { spawnTerminal } = mockTask('local');

    await createTerminal({
      id: 'terminal-1',
      projectId: 'project-1',
      taskId: 'task-1',
      name: 'Terminal 1',
    });

    expect(mocks.getAppSetting).toHaveBeenCalledWith('terminal');
    expect(insertValuesMock()).toHaveBeenCalledWith(expect.objectContaining({ shellId: 'bash' }));
    expect(spawnTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'terminal-1', shellId: 'bash' }),
      { cols: 80, rows: 24 },
      { shell: 'bash' }
    );
  });

  it('keeps remote terminals on the remote system shell', async () => {
    const { spawnTerminal } = mockTask('ssh');

    await createTerminal({
      id: 'terminal-1',
      projectId: 'project-1',
      taskId: 'task-1',
      name: 'Terminal 1',
    });

    expect(mocks.getAppSetting).not.toHaveBeenCalled();
    expect(insertValuesMock()).toHaveBeenCalledWith(expect.objectContaining({ shellId: 'system' }));
    expect(spawnTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'terminal-1', shellId: 'system' }),
      { cols: 80, rows: 24 },
      { shell: 'system' }
    );
  });

  it('treats an explicitly selected shell as a one-off override', async () => {
    const { spawnTerminal } = mockTask('local');

    await createTerminal({
      id: 'terminal-1',
      projectId: 'project-1',
      taskId: 'task-1',
      name: 'Terminal 1',
      shell: 'pwsh',
    });

    expect(mocks.getAppSetting).not.toHaveBeenCalled();
    expect(insertValuesMock()).toHaveBeenCalledWith(expect.objectContaining({ shellId: 'pwsh' }));
    expect(spawnTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'terminal-1', shellId: 'pwsh' }),
      { cols: 80, rows: 24 },
      { shell: 'pwsh' }
    );
  });

  it('persists the configured default shell and lets the provider resolve availability', async () => {
    const { spawnTerminal } = mockTask('local');

    await createTerminal({
      id: 'terminal-1',
      projectId: 'project-1',
      taskId: 'task-1',
      name: 'Terminal 1',
    });

    expect(insertValuesMock()).toHaveBeenCalledWith(expect.objectContaining({ shellId: 'bash' }));
    expect(spawnTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'terminal-1', shellId: 'bash' }),
      { cols: 80, rows: 24 },
      { shell: 'bash' }
    );
  });
});
